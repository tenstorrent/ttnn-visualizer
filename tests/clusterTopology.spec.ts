// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { PerRankInput, looksLikeRankedDescriptor, stitchClusterTopology } from '../src/functions/clusterTopology';
import { ClusterModel } from '../src/model/ClusterModel';

// Minimal ClusterModel factory; fills in defaults so tests can override only what they care about.
const makeDescriptor = (overrides: Partial<ClusterModel>): ClusterModel => ({
    arch: ['blackhole'],
    chips: {},
    ethernet_connections: [],
    chips_with_mmio: [],
    chip_to_boardtype: {},
    chip_to_bus_id: {},
    chip_unique_ids: {},
    boards: [],
    ...overrides,
});

describe('stitchClusterTopology', () => {
    it('returns isMultiHost=false for a single-host report', () => {
        const input: PerRankInput = {
            rank: 0,
            descriptor: makeDescriptor({
                ethernet_connections: [
                    [
                        { chip: 0, chan: 1 },
                        { chip: 1, chan: 2 },
                    ],
                ],
                chip_unique_ids: { 0: 100, 1: 101 },
            }),
            meshDescriptor: { 0: [0, 0, 0, 0], 1: [0, 1, 0, 0] },
        };

        const topology = stitchClusterTopology([input]);

        expect(topology.isMultiHost).toBe(false);
        expect(topology.worldSize).toBe(1);
        expect(topology.hosts).toHaveLength(1);
        expect(topology.intraHostLinks).toHaveLength(1);
        expect(topology.interHostLinks).toHaveLength(0);
        expect(topology.unresolvedRemoteCount).toBe(0);
    });

    it('resolves inter-host links via chip_unique_ids across hosts', () => {
        // 2-host topology: rank 0 has chips {0,1} with unique ids 100,101; rank 1 has {0,1} with 200,201.
        // A single inter-host link from (rank0, chip 1, chan 9) to (rank1, chip 0, chan 10) — listed
        // symmetrically by both hosts.
        const rank0: PerRankInput = {
            rank: 0,
            descriptor: makeDescriptor({
                chip_unique_ids: { 0: 100, 1: 101 },
                ethernet_connections_to_remote_devices: [
                    [
                        { chip: 1, chan: 9 },
                        { remote_chip_id: 200, chan: 10 },
                    ],
                ],
            }),
            meshDescriptor: { 0: [0, 0, 0, 0], 1: [0, 1, 0, 0] },
        };
        const rank1: PerRankInput = {
            rank: 1,
            descriptor: makeDescriptor({
                chip_unique_ids: { 0: 200, 1: 201 },
                ethernet_connections_to_remote_devices: [
                    [
                        { chip: 0, chan: 10 },
                        { remote_chip_id: 101, chan: 9 },
                    ],
                ],
            }),
            meshDescriptor: { 0: [0, 2, 0, 0], 1: [0, 3, 0, 0] },
        };

        const topology = stitchClusterTopology([rank0, rank1]);

        expect(topology.isMultiHost).toBe(true);
        expect(topology.worldSize).toBe(2);
        expect(topology.interHostLinks).toHaveLength(1);

        const [link] = topology.interHostLinks;
        // Canonical ordering puts (rank0, chip1, chan9) first (lex-smaller key).
        expect(link.a).toEqual({ rank: 0, chip: 1, chan: 9, chipUniqueId: 101 });
        expect(link.b).toEqual({ rank: 1, chip: 0, chan: 10, chipUniqueId: 200 });
        expect(topology.unresolvedRemoteCount).toBe(0);
    });

    it('drops inter-host link entries whose remote_chip_id is unknown and counts them', () => {
        const rank0: PerRankInput = {
            rank: 0,
            descriptor: makeDescriptor({
                chip_unique_ids: { 0: 100 },
                ethernet_connections_to_remote_devices: [
                    // First entry resolves via rank1; second references a uid no host advertises.
                    [
                        { chip: 0, chan: 1 },
                        { remote_chip_id: 200, chan: 2 },
                    ],
                    [
                        { chip: 0, chan: 3 },
                        { remote_chip_id: 999, chan: 4 },
                    ],
                ],
            }),
            meshDescriptor: null,
        };
        const rank1: PerRankInput = {
            rank: 1,
            descriptor: makeDescriptor({
                chip_unique_ids: { 0: 200 },
                ethernet_connections_to_remote_devices: [],
            }),
            meshDescriptor: null,
        };

        const topology = stitchClusterTopology([rank0, rank1]);

        expect(topology.interHostLinks).toHaveLength(1);
        expect(topology.unresolvedRemoteCount).toBe(1);
    });

    it('collects intra-host links from every rank tagged with the originating rank', () => {
        const rank0: PerRankInput = {
            rank: 0,
            descriptor: makeDescriptor({
                ethernet_connections: [
                    [
                        { chip: 0, chan: 1 },
                        { chip: 1, chan: 2 },
                    ],
                    [
                        { chip: 1, chan: 3 },
                        { chip: 2, chan: 4 },
                    ],
                ],
                chip_unique_ids: { 0: 1, 1: 2, 2: 3 },
            }),
            meshDescriptor: null,
        };
        const rank1: PerRankInput = {
            rank: 1,
            descriptor: makeDescriptor({
                ethernet_connections: [
                    [
                        { chip: 0, chan: 5 },
                        { chip: 1, chan: 6 },
                    ],
                ],
                chip_unique_ids: { 0: 100, 1: 101 },
            }),
            meshDescriptor: null,
        };

        const topology = stitchClusterTopology([rank0, rank1]);

        expect(topology.intraHostLinks).toHaveLength(3);
        expect(topology.intraHostLinks.filter((l) => l.rank === 0)).toHaveLength(2);
        expect(topology.intraHostLinks.filter((l) => l.rank === 1)).toHaveLength(1);
    });

    it('sorts hosts by rank regardless of input order', () => {
        const rank1: PerRankInput = {
            rank: 1,
            descriptor: makeDescriptor({ chip_unique_ids: { 0: 200 } }),
            meshDescriptor: null,
        };
        const rank0: PerRankInput = {
            rank: 0,
            descriptor: makeDescriptor({ chip_unique_ids: { 0: 100 } }),
            meshDescriptor: null,
        };

        const topology = stitchClusterTopology([rank1, rank0]);

        expect(topology.hosts.map((h) => h.rank)).toEqual([0, 1]);
    });

    it('preserves mesh coordinates per host', () => {
        const rank0: PerRankInput = {
            rank: 0,
            descriptor: makeDescriptor({ chip_unique_ids: { 0: 100, 1: 101 } }),
            meshDescriptor: { 0: [0, 0, 0, 0], 1: [0, 1, 0, 0] },
        };

        const topology = stitchClusterTopology([rank0]);

        expect(topology.hosts[0].meshChips).toEqual({ 0: [0, 0, 0, 0], 1: [0, 1, 0, 0] });
    });

    it('defaults meshChips to an empty object when mesh descriptor was unavailable', () => {
        const rank0: PerRankInput = {
            rank: 0,
            descriptor: makeDescriptor({ chip_unique_ids: { 0: 100 } }),
            meshDescriptor: null,
        };

        const topology = stitchClusterTopology([rank0]);

        expect(topology.hosts[0].meshChips).toEqual({});
    });

    it('handles a 2x8 fixture modelled on multihost_poc_jun19_2043', () => {
        // Simplified slice: each rank has 8 chips with unique ids in disjoint ranges, four inter-host
        // links between them. Each link appears on both hosts' `_to_remote_devices` list — the
        // stitcher must dedupe to 4 canonical entries.
        const rank0UniqueIds: Record<number, number> = {
            0: 1430,
            1: 1431,
            2: 1432,
            3: 1433,
            4: 1434,
            5: 1435,
            6: 1436,
            7: 1437,
        };
        const rank1UniqueIds: Record<number, number> = {
            0: 1440,
            1: 1441,
            2: 1442,
            3: 1443,
            4: 1444,
            5: 1445,
            6: 1446,
            7: 1447,
        };
        const rank0Remotes: ClusterModel['ethernet_connections_to_remote_devices'] = [
            [
                { chip: 1, chan: 9 },
                { remote_chip_id: 1440, chan: 10 },
            ],
            [
                { chip: 7, chan: 10 },
                { remote_chip_id: 1442, chan: 9 },
            ],
            [
                { chip: 5, chan: 10 },
                { remote_chip_id: 1444, chan: 9 },
            ],
            [
                { chip: 2, chan: 11 },
                { remote_chip_id: 1446, chan: 8 },
            ],
        ];
        const rank1Remotes: ClusterModel['ethernet_connections_to_remote_devices'] = [
            [
                { chip: 0, chan: 10 },
                { remote_chip_id: 1431, chan: 9 },
            ],
            [
                { chip: 2, chan: 9 },
                { remote_chip_id: 1437, chan: 10 },
            ],
            [
                { chip: 4, chan: 9 },
                { remote_chip_id: 1435, chan: 10 },
            ],
            [
                { chip: 6, chan: 8 },
                { remote_chip_id: 1432, chan: 11 },
            ],
        ];

        const topology = stitchClusterTopology([
            {
                rank: 0,
                descriptor: makeDescriptor({
                    chip_unique_ids: rank0UniqueIds,
                    ethernet_connections_to_remote_devices: rank0Remotes,
                }),
                meshDescriptor: null,
            },
            {
                rank: 1,
                descriptor: makeDescriptor({
                    chip_unique_ids: rank1UniqueIds,
                    ethernet_connections_to_remote_devices: rank1Remotes,
                }),
                meshDescriptor: null,
            },
        ]);

        expect(topology.worldSize).toBe(2);
        expect(topology.interHostLinks).toHaveLength(4);
        expect(topology.unresolvedRemoteCount).toBe(0);
        // Every inter-host link must reference both ranks.
        for (const link of topology.interHostLinks) {
            expect(new Set([link.a.rank, link.b.rank])).toEqual(new Set([0, 1]));
        }
    });
});

describe('looksLikeRankedDescriptor', () => {
    it('returns true when ethernet_connections_to_remote_devices is present (even if empty)', () => {
        const desc = {
            arch: [],
            chips: {},
            ethernet_connections: [],
            chips_with_mmio: [],
            ethernet_connections_to_remote_devices: [],
            chip_to_boardtype: {},
            chip_to_bus_id: {},
            chip_unique_ids: {},
            boards: [],
        } as ClusterModel;

        expect(looksLikeRankedDescriptor(desc)).toBe(true);
    });

    it('returns false for legacy single-host descriptors lacking the remote field', () => {
        const desc = {
            arch: [],
            chips: {},
            ethernet_connections: [],
            chips_with_mmio: [],
            chip_to_boardtype: {},
            chip_to_bus_id: {},
            chip_unique_ids: {},
            boards: [],
        } as ClusterModel;

        expect(looksLikeRankedDescriptor(desc)).toBe(false);
    });
});
