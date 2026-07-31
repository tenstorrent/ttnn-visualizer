// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClusterRenderer from '../src/components/cluster/ClusterRenderer';
import { ChipDesign, ClusterTopology } from '../src/model/ClusterModel';

// Cluster placement and links come from the cluster descriptor; the arch descriptor is
// only enrichment. An unrecognised arch used to blank the whole view because port uids
// were keyed off the arch eth list. #1772

// Two chips side by side, linked on channels 4 and 6 — the channels are what the port
// uids must key off, and channel 6 sits past the end of a 2-entry arch eth list so a
// regression to arch-indexed lookup would drop that port.
const topology = (): ClusterTopology =>
    ({
        isMultiHost: false,
        worldSize: 1,
        unresolvedRemoteCount: 0,
        hosts: [
            {
                rank: 0,
                descriptor: {
                    arch: ['wormhole_b0'],
                    chip_unique_ids: { 0: 100, 1: 101 },
                    chips_with_mmio: [{ 0: 0 }],
                    ethernet_connections: [],
                },
                meshChips: { 0: [0, 0, 0, 0], 1: [1, 0, 0, 0] },
            },
        ],
        intraHostLinks: [{ rank: 0, a: { chip: 0, chan: 4 }, b: { chip: 1, chan: 6 } }],
        interHostLinks: [],
    }) as unknown as ClusterTopology;

// Channel-indexed, mirroring the real arch json. Index 4 -> '9-0', index 6 -> '1-6'.
const ARCH: ChipDesign = {
    arch_name: 'wormhole_b0',
    grid: { x_size: 10, y_size: 12 },
    eth: ['0-0', '1-0', '2-0', '3-0', '9-0', '8-0', '1-6', '2-6'],
    pcie: ['0-3'],
    arc: [],
    dram: [],
    router_only: [],
    functional_workers: [],
} as unknown as ChipDesign;

const NO_ARCH = Object.freeze({}) as ChipDesign;

let chipDesign: ChipDesign = ARCH;

vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../src/hooks/useAPI', () => ({
    useGetClusterTopology: () => ({ data: topology(), isLoading: false, isError: false, error: null }),
    useArchitecture: () => chipDesign,
}));

const ports = () => [...document.querySelectorAll('.eth')];
const portLabels = () => ports().map((el) => el.querySelector('span')?.textContent ?? '');

// The component observes its scroll container to fit the topology; jsdom has no
// ResizeObserver and the fitted size is irrelevant to what these tests assert. Has to be
// a class — vitest rejects an arrow function used as a constructor mock.
/* eslint-disable class-methods-use-this -- no-op stub has nothing to hold */
class ResizeObserverStub {
    observe() {}

    unobserve() {}

    disconnect() {}
}
/* eslint-enable class-methods-use-this */

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    chipDesign = ARCH;
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('Cluster with a baked arch descriptor', () => {
    it('labels each port with its rank-chip-core coordinate', () => {
        render(<ClusterRenderer />);

        // chip 0 on channel 4 -> eth[4] = '9-0'; chip 1 on channel 6 -> eth[6] = '1-6'.
        expect(portLabels().sort()).toEqual(['0-0-9-0', '0-1-1-6']);
    });

    it('renders a PCIe marker on the mmio chip', () => {
        render(<ClusterRenderer />);

        expect(document.querySelectorAll('.mmio').length).toBeGreaterThan(0);
    });
});

describe('Cluster with no baked arch descriptor', () => {
    beforeEach(() => {
        chipDesign = NO_ARCH;
    });

    it('still renders a port per linked channel', () => {
        render(<ClusterRenderer />);

        // The link is the only source of channels, so both endpoints must still appear.
        expect(ports()).toHaveLength(2);
    });

    it('does not fall back to the unsupported-setup panel', () => {
        render(<ClusterRenderer />);

        // Matching the panel's actual copy — it reads "not supported", so asserting on
        // the word "unsupported" would pass no matter what the component rendered.
        expect(document.body.textContent).not.toContain('not supported for your current setup');
    });

    it('omits the coordinate labels rather than inventing them', () => {
        render(<ClusterRenderer />);

        expect(portLabels()).toEqual(['', '']);
    });

    it('omits PCIe markers', () => {
        render(<ClusterRenderer />);

        expect(document.querySelectorAll('.mmio')).toHaveLength(0);
    });

    it('keys ports by channel so the uid survives without the arch list', () => {
        render(<ClusterRenderer />);

        // Titles fall back to the uid when there is no coordinate to show.
        expect(
            ports()
                .map((el) => el.getAttribute('title'))
                .sort(),
        ).toEqual(['0-0-ch4', '0-1-ch6']);
    });
});
