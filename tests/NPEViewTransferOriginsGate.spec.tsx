// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NPEView from '../src/components/npe/NPEViewComponent';
import { NPEData } from '../src/model/NPEModel';

// `getOriginOpacity` returns 0 for every id-bearing transfer unless one is selected
// or highlighted, so in the ordinary scrub state the whole base origins layer is
// invisible. It used to be rendered anyway — thousands of `opacity: 0` divs rebuilt
// per scrub. These tests pin the gate that skips it. #1803

let originRenders = 0;

vi.mock('../src/components/npe/RouteOriginsRenderer', () => ({
    RouteOriginsRenderer: () => {
        originRenders += 1;
        return <div data-testid='route-origin' />;
    },
}));

vi.mock('../src/components/npe/NPETimelineComponent', () => ({ default: () => <div data-testid='timeline' /> }));
vi.mock('../src/components/npe/ChipCongestionCanvas', () => ({ default: () => null }));
vi.mock('../src/components/npe/TensixTransferRenderer', () => ({ default: () => null }));
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
                route: [{ device_id: 0, links: [[0, 0, 0, 'NOC0', 0.5, undefined]] }],
            },
        ],
        timestep_data: [
            {
                start_cycle: 0,
                end_cycle: 9,
                active_transfers: [1],
                link_demand: [[0, 0, 0, 'NOC0', 0.5, undefined]],
            },
        ],
        zones: [],
    }) as unknown as NPEData;

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    originRenders = 0;
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
});
