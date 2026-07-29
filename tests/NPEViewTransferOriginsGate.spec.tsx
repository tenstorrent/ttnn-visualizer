// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { act } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NPEView from '../src/components/npe/NPEViewComponent';
import { LinkUtilization, NPEData } from '../src/model/NPEModel';

// `getOriginOpacity` returns 0 for every id-bearing transfer unless one is selected
// or highlighted, so in the ordinary scrub state the whole base origins layer is
// invisible. It used to be rendered anyway — thousands of `opacity: 0` divs rebuilt
// per scrub. These tests pin the gate that skips it. #1803

let originRenders = 0;
const emptyChipHandlers: (() => void)[] = [];
// The link the fixture's transfer routes through, so selecting it matches a route.
const ROUTED_LINK = [0, 0, 0, 'NOC0_EAST', 50, undefined] as unknown as LinkUtilization;
let selectLink: (() => void) | undefined;

vi.mock('../src/components/npe/RouteOriginsRenderer', () => ({
    RouteOriginsRenderer: () => {
        originRenders += 1;
        return <div data-testid='route-origin' />;
    },
}));

vi.mock('../src/components/npe/NPETimelineComponent', () => ({ default: () => <div data-testid='timeline' /> }));
vi.mock('../src/components/npe/ChipCongestionCanvas', () => ({
    default: ({ onSelectLink }: { onSelectLink: (link: LinkUtilization, index: number) => void }) => {
        selectLink = () => onSelectLink(ROUTED_LINK, 0);
        return null;
    },
}));
vi.mock('../src/components/npe/TensixTransferRenderer', () => ({ default: () => null }));
vi.mock('../src/components/npe/ActiveTransferDetails', () => ({ default: () => null }));
vi.mock('../src/components/npe/NPEMetadata', () => ({ default: () => null }));
vi.mock('../src/components/npe/EmptyChipRenderer', () => ({
    EmptyChipRenderer: (props: { onEmptyCellClick: () => void }) => {
        emptyChipHandlers.push(props.onEmptyCellClick);
        return null;
    },
}));
vi.mock('../src/components/npe/NPEZoneFilterComponent', () => ({ default: () => null }));
vi.mock('../src/components/GlobalSwitch', () => ({ default: () => null }));
vi.mock('../src/functions/createToastNotification', () => ({ default: vi.fn() }));
// `useShowActiveTransfers` is deliberately NOT mocked away: it returns a new
// callback on every scrub, and the whole point of the `showActiveTransfersRef`
// indirection is to absorb that so the memoized children keep stable props.
vi.mock('../src/components/npe/useNPEHandlers', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/components/npe/useNPEHandlers')>()),
    useSelectedTransferGrouping: () => ({ transferListSelectionRendering: new Map(), groupedTransfersByNoCID: {} }),
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

// One chip with a transfer routed through it, active on the rendered timestep — so
// the layer has something it *could* draw.
const makeNpeData = (): NPEData =>
    ({
        common_info: { arch: 'wormhole_b0', version: '1.0.0', cycles_per_timestep: 1 },
        chips: { '0': [0, 0, 0, 0] },
        noc_transfers: [
            {
                id: 1,
                src: [0, 0, 0],
                dst: [[0, 1, 1]],
                route: [{ device_id: 0, links: [ROUTED_LINK] }],
            },
        ],
        timestep_data: [
            {
                start_cycle: 0,
                end_cycle: 9,
                active_transfers: [1],
                link_demand: [ROUTED_LINK],
            },
            {
                start_cycle: 10,
                end_cycle: 19,
                active_transfers: [1],
                link_demand: [ROUTED_LINK],
            },
        ],
        zones: [],
    }) as unknown as NPEData;

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    originRenders = 0;
    emptyChipHandlers.length = 0;
    selectLink = undefined;
});

describe('NPEView transfer origins gate', () => {
    it('skips the base origins layer while nothing is selected or highlighted', () => {
        render(<NPEView npeData={makeNpeData()} />);

        expect(screen.queryAllByTestId('route-origin')).toHaveLength(0);
        expect(originRenders).toBe(0);
    });

    it('still renders the rest of the view', () => {
        // Guards against the gate being satisfied by the view failing to render.
        render(<NPEView npeData={makeNpeData()} />);

        expect(screen.getByTestId('timeline')).toBeTruthy();
    });

    it('renders the origins layer once a transfer is selected', () => {
        // The direction that actually matters: a gate that is too aggressive drops
        // visible UI silently. Selecting a link is what makes the layer visible, and
        // the canvas resolves that click through `onSelectLink`.
        render(<NPEView npeData={makeNpeData()} />);
        expect(originRenders).toBe(0);

        act(() => selectLink?.());

        expect(screen.queryAllByTestId('route-origin').length).toBeGreaterThan(0);
    });
});

describe('NPEView memoized child stability', () => {
    it('hands the chip backdrop the same handler across a scrub', () => {
        // `useShowActiveTransfers` returns a fresh callback per scrub; the ref
        // indirection exists so `memo(EmptyChipRenderer)` still holds. Passing the
        // raw handler instead would silently un-memoize every backdrop — the exact
        // regression #1803 fixes, and one no other assertion would catch.
        const { rerender } = render(
            <NPEView
                npeData={makeNpeData()}
                selectedTimestep={0}
                onSelectedTimestepChange={vi.fn()}
                reportKey='report'
            />,
        );
        const first = emptyChipHandlers.at(-1);

        rerender(
            <NPEView
                npeData={makeNpeData()}
                selectedTimestep={1}
                onSelectedTimestepChange={vi.fn()}
                reportKey='report'
            />,
        );

        expect(emptyChipHandlers.length).toBeGreaterThan(1);
        expect(emptyChipHandlers.at(-1)).toBe(first);
    });
});
