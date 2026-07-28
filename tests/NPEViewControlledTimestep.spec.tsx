// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { act } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NPEView from '../src/components/npe/NPEViewComponent';
import { NPEData } from '../src/model/NPEModel';

// Capture the timestep the timeline is told to render + its navigation callback,
// so we can observe resets and drive an uncontrolled scrub.
const timeline: { currentTimestep?: number; navigate?: (t: number) => void } = {};

vi.mock('../src/components/npe/NPETimelineComponent', () => ({
    default: ({
        currentTimestep,
        navigationCallback,
    }: {
        currentTimestep: number;
        navigationCallback: (t: number) => void;
    }) => {
        timeline.currentTimestep = currentTimestep;
        timeline.navigate = navigationCallback;
        return <div data-testid='timeline'>step:{currentTimestep}</div>;
    },
}));

// The heavy visual children + data hooks are irrelevant to the reset behaviour.
vi.mock('../src/components/npe/TensixTransferRenderer', () => ({ default: () => null }));
vi.mock('../src/components/npe/RouteOriginsRenderer', () => ({ RouteOriginsRenderer: () => null }));
vi.mock('../src/components/npe/ActiveTransferDetails', () => ({ default: () => null }));
vi.mock('../src/components/npe/NPEMetadata', () => ({ default: () => null }));
vi.mock('../src/components/npe/EmptyChipRenderer', () => ({ EmptyChipRenderer: () => null }));
vi.mock('../src/components/npe/NPEZoneFilterComponent', () => ({ default: () => null }));
vi.mock('../src/components/GlobalSwitch', () => ({ default: () => null }));
vi.mock('../src/functions/createToastNotification', () => ({ default: vi.fn() }));
vi.mock('../src/components/npe/useNPEHandlers', () => ({
    useSelectedTransferGrouping: () => ({ transferListSelectionRendering: new Map(), groupedTransfersByNoCID: {} }),
    useShowActiveTransfers: () => vi.fn(),
}));
vi.mock('../src/hooks/useAPI', () => ({
    useNodeType: () => ({
        architecture: { arch_name: 'wormhole_b0', grid: { x_size: 2, y_size: 2 } },
        cores: [],
        dram: [],
        eth: [],
        pcie: [],
    }),
}));

const makeNpeData = (): NPEData =>
    ({
        common_info: { arch: 'wormhole_b0', version: '1.0.0', cycles_per_timestep: 1 },
        chips: { '0': [0, 0, 0, 0] },
        noc_transfers: [],
        timestep_data: [
            { start_cycle: 0, end_cycle: 9, active_transfers: [], link_demand: [] },
            { start_cycle: 10, end_cycle: 19, active_transfers: [], link_demand: [] },
        ],
        zones: [],
    }) as unknown as NPEData;

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    timeline.currentTimestep = undefined;
    timeline.navigate = undefined;
});

describe('NPEView controlled timestep', () => {
    it('does not reset the timestep when npeData identity changes under the same reportKey', () => {
        const onChange = vi.fn();
        const { rerender } = render(
            <NPEView
                npeData={makeNpeData()}
                reportKey='report-A'
                selectedTimestep={1}
                onSelectedTimestepChange={onChange}
            />,
        );
        expect(timeline.currentTimestep).toBe(1);

        // A windowed refetch produces a fresh npeData object with the SAME reportKey.
        rerender(
            <NPEView
                npeData={makeNpeData()}
                reportKey='report-A'
                selectedTimestep={1}
                onSelectedTimestepChange={onChange}
            />,
        );

        // Parent still owns the value; the component must not snap it back to 0.
        expect(onChange).not.toHaveBeenCalled();
        expect(timeline.currentTimestep).toBe(1);
    });

    it('does not self-reset the controlled timestep even when reportKey changes', () => {
        const onChange = vi.fn();
        const { rerender } = render(
            <NPEView
                npeData={makeNpeData()}
                reportKey='report-A'
                selectedTimestep={1}
                onSelectedTimestepChange={onChange}
            />,
        );

        rerender(
            <NPEView
                npeData={makeNpeData()}
                reportKey='report-B'
                selectedTimestep={1}
                onSelectedTimestepChange={onChange}
            />,
        );

        // Controlled mode delegates report-switch resets to the container, so the
        // component never calls the parent setter to force 0 itself.
        expect(onChange).not.toHaveBeenCalled();
    });

    it('uncontrolled mode still resets the internal timestep to 0 on npeData change', () => {
        const { rerender } = render(<NPEView npeData={makeNpeData()} />);

        act(() => timeline.navigate?.(1));
        expect(timeline.currentTimestep).toBe(1);

        // New npeData object (no reportKey) → the reset effect fires and clears it.
        rerender(<NPEView npeData={makeNpeData()} />);
        expect(timeline.currentTimestep).toBe(0);
    });
});
