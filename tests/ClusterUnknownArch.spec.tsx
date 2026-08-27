// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClusterRenderer from '../src/components/cluster/ClusterRenderer';
import { ClusterTopology, IntraHostEthernetLink } from '../src/model/ClusterModel';

// Cluster placement and links come from the cluster descriptor; the arch descriptor is
// only enrichment. An unrecognised arch used to blank the whole view because port uids
// were keyed off the arch eth list. #1772
//
// The real `getChipDesign` is used deliberately — these assert against the baked
// wormhole json, so a change to its channel ordering surfaces here.

const DEFAULT_LINKS: IntraHostEthernetLink[] = [{ rank: 0, a: { chip: 0, chan: 4 }, b: { chip: 1, chan: 6 } }];

// Two chips side by side. Channels 4 and 6 are both in range for the wormhole (16 entries)
// and blackhole (14) eth lists, so the label assertions compare two real arch lookups rather
// than one lookup and one miss — the out-of-range case is covered separately below.
// `arch` is keyed by chip id, matching the YAML.
const twoChipTopology = (
    arch: Record<number, string>,
    intraHostLinks: IntraHostEthernetLink[] = DEFAULT_LINKS,
): ClusterTopology =>
    ({
        isMultiHost: false,
        worldSize: 1,
        unresolvedRemoteCount: 0,
        hosts: [
            {
                rank: 0,
                descriptor: {
                    arch,
                    chip_unique_ids: { 0: '100', 1: '101' },
                    chips_with_mmio: [{ 0: 0 }],
                    ethernet_connections: [],
                },
                meshChips: { 0: [0, 0, 0, 0], 1: [1, 0, 0, 0] },
            },
        ],
        intraHostLinks,
        interHostLinks: [],
    }) as unknown as ClusterTopology;

// One chip per host, both with local id 0, linked across the hosts. Local chip ids collide
// across ranks, so this is the fixture that distinguishes a rank-qualified uid from a
// chip-id-only one — the latter would collapse both endpoints onto a single port.
const twoHostTopology = (arch: Record<number, string>): ClusterTopology =>
    ({
        isMultiHost: true,
        worldSize: 2,
        unresolvedRemoteCount: 0,
        hosts: [0, 1].map((rank) => ({
            rank,
            descriptor: {
                arch,
                chip_unique_ids: { 0: `100${rank}` },
                chips_with_mmio: [{ 0: 0 }],
                ethernet_connections: [],
            },
            meshChips: { 0: [rank, 0, 0, 0] },
        })),
        intraHostLinks: [],
        interHostLinks: [
            {
                a: { rank: 0, chip: 0, chan: 4, chipUniqueId: '100' },
                b: { rank: 1, chip: 0, chan: 4, chipUniqueId: '101' },
            },
        ],
    }) as unknown as ClusterTopology;

const WORMHOLE = { 0: 'wormhole_b0', 1: 'wormhole_b0' };
const BLACKHOLE = { 0: 'blackhole', 1: 'blackhole' };
// Neither prefix-matches a baked descriptor, so it resolves to no design.
const UNKNOWN_ARCH = { 0: 'quasar', 1: 'quasar' };

let clusterArch: Record<number, string> = WORMHOLE;
// Set by tests that need a shape the arch knob can't express (extra links, multi-host, no hosts).
let topologyOverride: ClusterTopology | null = null;

vi.mock('react-router', async () => ({
    ...(await vi.importActual<typeof import('react-router')>('react-router')),
    useNavigate: () => vi.fn(),
}));
vi.mock('../src/hooks/useAPI', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/hooks/useAPI')>()),
    useGetClusterTopology: () => ({
        data: topologyOverride ?? twoChipTopology(clusterArch),
        isLoading: false,
        isError: false,
        error: null,
    }),
}));

const ports = () => [...document.querySelectorAll('.eth')];
const portLabels = () => ports().map((el) => el.querySelector('span')?.textContent ?? '');
const portTitles = () => ports().map((el) => el.getAttribute('title') ?? '');
const links = () => [...document.querySelectorAll('.cluster-link')];

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
    topologyOverride = null;
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

    // A segment only draws when the uid built at the link pass matches the one the port
    // pass registered. Those are separate constructions of the same key, so a drift
    // between them silently drops every link while ports, labels and markers all survive.
    it('draws a segment for the link', () => {
        render(<ClusterRenderer />);

        expect(links()).toHaveLength(1);
    });
});

describe('Cluster with a Blackhole arch', () => {
    beforeEach(() => {
        clusterArch = BLACKHOLE;
    });

    // Blackhole's eth channel map is disjoint from Wormhole's, so these labels are what
    // separates "resolved per chip" from "resolved to Wormhole regardless" — the defect
    // this ticket uncovered, where every report was enriched from the wormhole list.
    it('labels ports from the Blackhole eth list, not Wormhole’s', () => {
        render(<ClusterRenderer />);

        // Blackhole eth: [4] = '5-1', [6] = '7-1'. Wormhole would give '7-0' / '6-0'.
        expect(portLabels().sort()).toEqual(['0-0-5-1', '0-1-7-1']);
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

    // The point of the ticket: links resolve from the cluster descriptor alone.
    it('still draws a segment for the link', () => {
        render(<ClusterRenderer />);

        expect(links()).toHaveLength(1);
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

        expect(portTitles().sort()).toEqual(['0-0-ch4', '0-1-ch6']);
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

// Distinct from an unrecognised arch: the arch resolves, but the descriptor reports a channel
// the baked list is too short to cover. Since #1772 sources ports from the cluster descriptor
// and labels from the arch one independently, the two can disagree per channel.
describe('Cluster with a channel past the end of the baked eth list', () => {
    beforeEach(() => {
        // Wormhole's eth list covers channels 0-15.
        topologyOverride = twoChipTopology(WORMHOLE, [{ rank: 0, a: { chip: 0, chan: 4 }, b: { chip: 1, chan: 20 } }]);
    });

    it('still renders both ports', () => {
        render(<ClusterRenderer />);

        expect(ports()).toHaveLength(2);
    });

    it('still draws the link', () => {
        render(<ClusterRenderer />);

        expect(links()).toHaveLength(1);
    });

    it('labels the in-range channel and leaves the out-of-range one blank', () => {
        render(<ClusterRenderer />);

        // Wormhole eth[4] = '7-0'; channel 20 has no entry.
        expect(portLabels().sort()).toEqual(['', '0-0-7-0']);
    });

    // Pins the deliberate split between the two: the tooltip falls back to the uid so the port
    // stays identifiable, while the inline label stays empty rather than showing a raw uid.
    it('keeps the unlabelled port identifiable by uid in its tooltip', () => {
        render(<ClusterRenderer />);

        expect(portTitles().sort()).toEqual(['0-0-7-0', '0-1-ch20']);
    });
});

describe('Cluster spanning two hosts', () => {
    beforeEach(() => {
        topologyOverride = twoHostTopology(WORMHOLE);
    });

    it('draws the inter-host link', () => {
        render(<ClusterRenderer />);

        expect(links()).toHaveLength(1);
    });

    // Both endpoints are chip 0 on channel 4; only the rank separates them. An unqualified
    // uid would collapse them into one port and lose the link.
    it('qualifies ports by rank so same-id chips on different hosts do not collide', () => {
        render(<ClusterRenderer />);

        expect(ports()).toHaveLength(2);
        expect(portLabels().sort()).toEqual(['0-0-7-0', '1-0-7-0']);
    });

    it('badges each chip with its host rank', () => {
        render(<ClusterRenderer />);

        // Sorted: condensed layout orders hosts by connection proximity, not by rank.
        expect([...document.querySelectorAll('.chip-rank-badge')].map((el) => el.textContent ?? '').sort()).toEqual([
            'R0',
            'R1',
        ]);
    });
});

describe('Cluster where a channel appears on two links', () => {
    beforeEach(() => {
        // Chip 0 channel 4 is reported twice. Without the dedupe both would place a port at
        // the same coordinates, and only the last write would survive into `portPixelByUid`.
        topologyOverride = twoChipTopology(WORMHOLE, [
            { rank: 0, a: { chip: 0, chan: 4 }, b: { chip: 1, chan: 6 } },
            { rank: 0, a: { chip: 0, chan: 4 }, b: { chip: 1, chan: 7 } },
        ]);
    });

    it('draws one port per channel, not one per link', () => {
        render(<ClusterRenderer />);

        // Chip 0 contributes channel 4 once; chip 1 contributes channels 6 and 7.
        expect(portTitles().sort()).toEqual(['0-0-7-0', '0-1-4-0', '0-1-6-0']);
    });
});

// Counterpart to the negative assertion above: without this, that test would pass even if the
// panel were unreachable, since it only checks the copy is *absent*.
describe('Cluster with no hosts', () => {
    beforeEach(() => {
        topologyOverride = {
            isMultiHost: false,
            worldSize: 0,
            unresolvedRemoteCount: 0,
            hosts: [],
            intraHostLinks: [],
            interHostLinks: [],
        } as unknown as ClusterTopology;
    });

    it('falls back to the unsupported-setup panel', () => {
        render(<ClusterRenderer />);

        expect(document.body.textContent).toContain('not supported for your current setup');
    });

    it('renders no chips or ports', () => {
        render(<ClusterRenderer />);

        expect(ports()).toHaveLength(0);
        expect(document.querySelectorAll('.chip')).toHaveLength(0);
    });
});
