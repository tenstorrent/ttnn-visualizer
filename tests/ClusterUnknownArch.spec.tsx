// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClusterRenderer from '../src/components/cluster/ClusterRenderer';
import { ClusterTopology } from '../src/model/ClusterModel';

// Cluster placement and links come from the cluster descriptor; the arch descriptor is
// only enrichment. An unrecognised arch used to blank the whole view because port uids
// were keyed off the arch eth list. #1772
//
// The real `getChipDesign` is used deliberately — these assert against the baked
// wormhole json, so a change to its channel ordering surfaces here.

// Two chips side by side, linked on channels 4 and 6. Channel 6 sits past the end of a
// short eth list, so a regression to arch-indexed lookup drops that port rather than
// mislabelling it. `arch` is keyed by chip id, matching the YAML.
const topology = (arch: Record<number, string>): ClusterTopology =>
    ({
        isMultiHost: false,
        worldSize: 1,
        unresolvedRemoteCount: 0,
        hosts: [
            {
                rank: 0,
                descriptor: {
                    arch,
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

const WORMHOLE = { 0: 'wormhole_b0', 1: 'wormhole_b0' };
// Neither substring-matches a baked descriptor, so it resolves to no design.
const UNKNOWN_ARCH = { 0: 'quasar', 1: 'quasar' };

let clusterArch: Record<number, string> = WORMHOLE;

vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../src/hooks/useAPI', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/hooks/useAPI')>()),
    useGetClusterTopology: () => ({ data: topology(clusterArch), isLoading: false, isError: false, error: null }),
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
    clusterArch = WORMHOLE;
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('Cluster with a recognised arch', () => {
    it('labels each port with its rank-chip-core coordinate', () => {
        render(<ClusterRenderer />);

        // Wormhole eth is channel-indexed: [4] = '7-0', [6] = '6-0'.
        expect(portLabels().sort()).toEqual(['0-0-7-0', '0-1-6-0']);
    });

    it('renders a PCIe marker on the mmio chip', () => {
        render(<ClusterRenderer />);

        expect(document.querySelectorAll('.mmio').length).toBeGreaterThan(0);
    });
});

describe('Cluster with an unrecognised arch', () => {
    beforeEach(() => {
        clusterArch = UNKNOWN_ARCH;
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

    it('omits the coordinate labels rather than borrowing another arch’s', () => {
        render(<ClusterRenderer />);

        expect(portLabels()).toEqual(['', '']);
    });

    it('omits PCIe markers', () => {
        render(<ClusterRenderer />);

        expect(document.querySelectorAll('.mmio')).toHaveLength(0);
    });

    it('keys ports by channel so the uid survives without an eth list', () => {
        render(<ClusterRenderer />);

        expect(
            ports()
                .map((el) => el.getAttribute('title'))
                .sort(),
        ).toEqual(['0-0-ch4', '0-1-ch6']);
    });
});

describe('Cluster with a heterogeneous arch', () => {
    it('enriches each chip from its own arch entry', () => {
        clusterArch = { 0: 'wormhole_b0', 1: 'quasar' };
        render(<ClusterRenderer />);

        // Chip 0 resolves, chip 1 does not — one label, not a cluster-wide guess.
        expect(portLabels().sort()).toEqual(['', '0-0-7-0']);
    });

    it('does not let an unresolved first chip suppress the rest', () => {
        clusterArch = { 0: 'quasar', 1: 'wormhole_b0' };
        render(<ClusterRenderer />);

        expect(portLabels().sort()).toEqual(['', '0-1-6-0']);
    });
});
