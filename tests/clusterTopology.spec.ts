// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    PerRankInput,
    hostHasMeshCoords,
    hostHasTwoDimensionalMesh,
    looksLikeRankedDescriptor,
    pickMeshDocForRank,
    sortHostsByConnectionProximity,
    stitchClusterTopology,
} from '../src/functions/clusterTopology';
import { ClusterHost, ClusterModel, InterHostEthernetLink, MeshData, MeshDataDocs } from '../src/model/ClusterModel';

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

describe('pickMeshDocForRank', () => {
    it('passes through a legacy single-doc response unchanged', () => {
        const single: MeshData = { chips: { 0: [0, 0, 0, 0], 1: [0, 1, 0, 0] } };
        expect(pickMeshDocForRank(single, 0)).toBe(single);
        expect(pickMeshDocForRank(single, 5)).toBe(single);
    });

    it('selects the doc with the lowest min-y for rank 0', () => {
        // doc[0] in source order has higher y values (rank 1's chips); doc[1] has lower
        // y values (rank 0's chips). Reflects the actual ordering in
        // multihost_poc_jun19_2043 where the backend's safe_load only returned
        // the first (rank 1's) doc.
        const response: MeshDataDocs = {
            docs: [{ chips: { 0: [0, 12, 0, 0], 5: [0, 8, 0, 0] } }, { chips: { 0: [0, 6, 0, 0], 5: [0, 2, 0, 0] } }],
        };
        expect(pickMeshDocForRank(response, 0)).toBe(response.docs[1]);
        expect(pickMeshDocForRank(response, 1)).toBe(response.docs[0]);
    });

    it('falls back to the first sorted doc when rank is out of bounds', () => {
        const response: MeshDataDocs = {
            docs: [{ chips: { 0: [0, 5, 0, 0] } }, { chips: { 0: [0, 0, 0, 0] } }],
        };
        // No exact match for rank 5; return the first sorted doc (lowest min-y)
        // so the renderer can still produce *something* visible.
        expect(pickMeshDocForRank(response, 5)).toBe(response.docs[1]);
    });

    it('treats an empty docs array as missing mesh data', () => {
        const fallback = pickMeshDocForRank({ docs: [] }, 0);
        expect(fallback).toEqual({ chips: {} });
    });
});

describe('looksLikeRankedDescriptor', () => {
    const baseDescriptor = {
        arch: [],
        chips: {},
        ethernet_connections: [],
        chips_with_mmio: [],
        chip_to_boardtype: {},
        chip_to_bus_id: {},
        chip_unique_ids: {},
        boards: [],
    };

    it('returns true only when remote-eth AND chip-unique-ids are populated', () => {
        const ranked = {
            ...baseDescriptor,
            ethernet_connections_to_remote_devices: [
                [
                    { chip: 0, chan: 9 },
                    { remote_chip_id: 42, chan: 10 },
                ],
            ],
            chip_unique_ids: { 0: 1234 },
        } as unknown as ClusterModel;

        expect(looksLikeRankedDescriptor(ranked)).toBe(true);
    });

    it('returns false for legacy single-host descriptors lacking the remote field', () => {
        expect(looksLikeRankedDescriptor(baseDescriptor as ClusterModel)).toBe(false);
    });

    it('returns false when the remote-eth field is present but empty', () => {
        const desc = {
            ...baseDescriptor,
            ethernet_connections_to_remote_devices: [],
            chip_unique_ids: { 0: 1234 },
        } as unknown as ClusterModel;
        // An empty remote-connections array means there are no cross-host links,
        // which we treat as single-host (galaxy can't trigger a 32-rank probe).
        expect(looksLikeRankedDescriptor(desc)).toBe(false);
    });

    it('returns false when chip_unique_ids is missing or empty', () => {
        const desc = {
            ...baseDescriptor,
            ethernet_connections_to_remote_devices: [
                [
                    { chip: 0, chan: 9 },
                    { remote_chip_id: 42, chan: 10 },
                ],
            ],
            chip_unique_ids: {},
        } as unknown as ClusterModel;
        expect(looksLikeRankedDescriptor(desc)).toBe(false);
    });

    it('returns false when the remote-eth field is null instead of undefined', () => {
        // Some backend serialisers emit null for missing YAML keys; guard
        // against that since `!== undefined` would let it through.
        const desc = {
            ...baseDescriptor,
            ethernet_connections_to_remote_devices: null,
        } as unknown as ClusterModel;
        expect(looksLikeRankedDescriptor(desc)).toBe(false);
    });
});

describe('sortHostsByConnectionProximity', () => {
    // 8-chip host with cross-host links rooted in `bottomRow` (true) → rank's
    // mean local-y skews toward 1; `false` → skews toward 0 (chips 0-3, top
    // row in the 4-wide × 2-row local grid).
    const makeHost = (rank: number, chipUniqueIds: Record<number, number>): ClusterHost => ({
        rank,
        descriptor: {
            arch: [],
            chips: {},
            ethernet_connections: [],
            chips_with_mmio: [],
            chip_to_boardtype: {},
            chip_to_bus_id: {},
            chip_unique_ids: chipUniqueIds,
            boards: [],
        } as unknown as ClusterModel,
        meshChips: {},
    });
    const eightChips = (offset: number) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].map((id) => [id, offset + id]));

    const link = (rankA: number, chipA: number, rankB: number, chipB: number): InterHostEthernetLink => ({
        a: { rank: rankA, chip: chipA, chan: 0, chipUniqueId: 0 },
        b: { rank: rankB, chip: chipB, chan: 0, chipUniqueId: 0 },
    });

    it('places the host whose connection chips sit in its BOTTOM row on top', () => {
        // Rank 1's connecting chips are 4–7 (local_y = 1, bottom row); rank 0's
        // are 0–3 (local_y = 0, top row). Rank 1 should sort first.
        const hosts = [makeHost(0, eightChips(0)), makeHost(1, eightChips(100))];
        const interHostLinks = [link(0, 0, 1, 4), link(0, 1, 1, 5), link(0, 2, 1, 6), link(0, 3, 1, 7)];

        const ordered = sortHostsByConnectionProximity(hosts, interHostLinks);

        expect(ordered.map((h) => h.rank)).toEqual([1, 0]);
    });

    it('flips the order when the connection-chip rows swap', () => {
        // Symmetric case: now rank 0's chips 4-7 connect to rank 1's chips 0-3.
        const hosts = [makeHost(0, eightChips(0)), makeHost(1, eightChips(100))];
        const interHostLinks = [link(0, 4, 1, 0), link(0, 5, 1, 1), link(0, 6, 1, 2), link(0, 7, 1, 3)];

        const ordered = sortHostsByConnectionProximity(hosts, interHostLinks);

        expect(ordered.map((h) => h.rank)).toEqual([0, 1]);
    });

    it('falls back to rank-descending when there are no inter-host links', () => {
        const hosts = [makeHost(0, eightChips(0)), makeHost(1, eightChips(100)), makeHost(2, eightChips(200))];
        const ordered = sortHostsByConnectionProximity(hosts, []);
        expect(ordered.map((h) => h.rank)).toEqual([2, 1, 0]);
    });
});

describe('mesh-availability helpers', () => {
    const makeHost = (meshChips: ClusterHost['meshChips']): ClusterHost => ({
        rank: 0,
        descriptor: {
            arch: [],
            chips: {},
            ethernet_connections: [],
            chips_with_mmio: [],
            chip_to_boardtype: {},
            chip_to_bus_id: {},
            chip_unique_ids: {},
            boards: [],
        } as unknown as ClusterModel,
        meshChips,
    });

    describe('hostHasMeshCoords', () => {
        it('accepts a 1D mesh where only y varies (multihost_poc_jun24 single host slice)', () => {
            const host = makeHost({
                6: [0, 0, 0, 0],
                4: [0, 1, 0, 0],
                5: [0, 2, 0, 0],
                7: [0, 3, 0, 0],
            });
            expect(hostHasMeshCoords(host)).toBe(true);
        });

        it('accepts a 1D mesh where only x varies', () => {
            const host = makeHost({
                0: [0, 0, 0, 0],
                1: [1, 0, 0, 0],
                2: [2, 0, 0, 0],
            });
            expect(hostHasMeshCoords(host)).toBe(true);
        });

        it('accepts a true 2D mesh (galaxy-shaped)', () => {
            const host = makeHost({
                0: [0, 0, 0, 0],
                1: [1, 0, 0, 0],
                2: [0, 1, 0, 0],
                3: [1, 1, 0, 0],
            });
            expect(hostHasMeshCoords(host)).toBe(true);
        });

        it('rejects a fully-degenerate mesh where every chip sits at the same point', () => {
            // Mirrors multihost_poc_jun19_2043's mesh-descriptor where every chip collapsed to (0,0).
            const host = makeHost({
                0: [0, 0, 0, 0],
                1: [0, 0, 0, 0],
                2: [0, 0, 0, 0],
            });
            expect(hostHasMeshCoords(host)).toBe(false);
        });

        it('rejects an empty mesh', () => {
            expect(hostHasMeshCoords(makeHost({}))).toBe(false);
        });
    });

    describe('hostHasTwoDimensionalMesh', () => {
        it('requires BOTH axes to vary', () => {
            const oneD = makeHost({ 0: [0, 0, 0, 0], 1: [0, 1, 0, 0] });
            const twoD = makeHost({ 0: [0, 0, 0, 0], 1: [1, 0, 0, 0], 2: [0, 1, 0, 0] });
            expect(hostHasTwoDimensionalMesh(oneD)).toBe(false);
            expect(hostHasTwoDimensionalMesh(twoD)).toBe(true);
        });

        it('rejects fully-degenerate and empty meshes', () => {
            expect(hostHasTwoDimensionalMesh(makeHost({}))).toBe(false);
            expect(hostHasTwoDimensionalMesh(makeHost({ 0: [0, 0, 0, 0] }))).toBe(false);
        });
    });
});
