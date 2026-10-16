// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';

import {
    buildHotOpRows,
    buildHotRankByNodeId,
    getMarkedHotOpRanks,
    getVisibleHotOpRows,
} from '../src/components/operation-graph/opGraphHotOps';
import { buildOpGraphPerfOverlay } from '../src/components/operation-graph/opGraphPerfOverlay';
import { HotOpsSort } from '../src/definitions/HotOps';
import type { OpGraphNodeIndexEntry } from '../src/components/operation-graph/opGraphTypes';
import type { PerfOverlaySource } from '../src/functions/perfOverlay';

// `device_time` is microseconds on the wire; the aggregator converts to ns.
const rows = (...pairs: [id: number, deviceTimeUs: number][]): PerfOverlaySource[] =>
    pairs.map(([id, deviceTimeUs]) => ({ id, device_time: deviceTimeUs }));

const NAMES = new Map([
    [1, 'ttnn.add'],
    [2, 'ttnn.matmul'],
    [3, 'ttnn.conv2d'],
    [4, 'ttnn.relu'],
    [5, 'ttnn.softmax'],
]);

// Ops 4 and 5 are on the graph with no perf row; 900 has a row but is not on the graph.
const overlay = buildOpGraphPerfOverlay(rows([1, 10], [2, 30], [3, 20], [900, 99]), true, [1, 2, 3, 4, 5]);

const ids = (list: readonly { operationId: number }[]) => list.map((row) => row.operationId);

describe('buildHotOpRows', () => {
    it('lists the linked ops slowest first, then the ops without perf data by id', () => {
        const hotOps = buildHotOpRows(overlay, [5, 4, 3, 2, 1], NAMES);

        expect(ids(hotOps)).toEqual([2, 3, 1, 4, 5]);
        expect(hotOps.map((row) => row.rank)).toEqual([1, 2, 3, null, null]);
    });

    it('carries each op its name and kernel duration', () => {
        const [slowest, , , unlinked] = buildHotOpRows(overlay, [1, 2, 3, 4, 5], NAMES);

        expect(slowest).toEqual({ operationId: 2, name: 'ttnn.matmul', deviceTimeNs: 30_000, rank: 1 });
        expect(unlinked).toEqual({ operationId: 4, name: 'ttnn.relu', deviceTimeNs: null, rank: null });
    });

    it('lists an op once however many graph nodes name it', () => {
        // A folded block contributes its members, and a member can surface twice.
        expect(ids(buildHotOpRows(overlay, [1, 2, 3, 4, 4, 5, 5], NAMES))).toEqual([2, 3, 1, 4, 5]);
    });

    it('leaves out ops with a perf row that the graph does not show', () => {
        expect(ids(buildHotOpRows(overlay, [1, 2, 3, 4, 5], NAMES))).not.toContain(900);
    });

    it('treats an op whose only perf row has no duration as having no perf data', () => {
        // It draws no bar, so a ranked row with a cold-end swatch would match nothing.
        const withZero = buildOpGraphPerfOverlay(rows([1, 10], [2, 0]), true, [1, 2]);

        expect(buildHotOpRows(withZero, [1, 2], NAMES)).toEqual([
            { operationId: 1, name: 'ttnn.add', deviceTimeNs: 10_000, rank: 1 },
            { operationId: 2, name: 'ttnn.matmul', deviceTimeNs: null, rank: null },
        ]);
    });
});

describe('getVisibleHotOpRows', () => {
    const all = buildHotOpRows(overlay, [1, 2, 3, 4, 5], NAMES);

    it('keeps the slowest ops up to the limit', () => {
        expect(ids(getVisibleHotOpRows(all, { limit: 2, sort: HotOpsSort.DURATION, hideUnlinked: true }))).toEqual([
            2, 3,
        ]);
    });

    it('keeps every linked op with no limit', () => {
        expect(ids(getVisibleHotOpRows(all, { limit: null, sort: HotOpsSort.DURATION, hideUnlinked: true }))).toEqual([
            2, 3, 1,
        ]);
    });

    it('adds the ops without perf data after the ranked ones when asked', () => {
        expect(ids(getVisibleHotOpRows(all, { limit: null, sort: HotOpsSort.DURATION, hideUnlinked: false }))).toEqual([
            2, 3, 1, 4, 5,
        ]);
    });

    it('fills a limit with ranked ops before any op without perf data', () => {
        expect(ids(getVisibleHotOpRows(all, { limit: 4, sort: HotOpsSort.DURATION, hideUnlinked: false }))).toEqual([
            2, 3, 1, 4,
        ]);
    });

    it('orders by id only the ops the limit kept', () => {
        // Sorting first would keep the lowest ids rather than the slowest ops.
        expect(ids(getVisibleHotOpRows(all, { limit: 2, sort: HotOpsSort.OPERATION_ID, hideUnlinked: true }))).toEqual([
            2, 3,
        ]);
        expect(ids(getVisibleHotOpRows(all, { limit: 3, sort: HotOpsSort.OPERATION_ID, hideUnlinked: true }))).toEqual([
            1, 2, 3,
        ]);
    });

    it('keeps ops without perf data last when ordering by id', () => {
        // Op 1 has no perf row, so by id alone it would lead the linked ops.
        const lowUnlinked = buildOpGraphPerfOverlay(rows([10, 5], [20, 30]), true, [1, 10, 20]);
        const listed = buildHotOpRows(lowUnlinked, [1, 10, 20], NAMES);

        expect(
            ids(getVisibleHotOpRows(listed, { limit: null, sort: HotOpsSort.OPERATION_ID, hideUnlinked: false })),
        ).toEqual([10, 20, 1]);
    });

    it('does not reorder the rows it was given', () => {
        getVisibleHotOpRows(all, { limit: null, sort: HotOpsSort.OPERATION_ID, hideUnlinked: false });

        expect(ids(all)).toEqual([2, 3, 1, 4, 5]);
    });
});

// The graph badges exactly the ops the list shows, so the list's two filters decide it. #2085
describe('getMarkedHotOpRanks', () => {
    const all = buildHotOpRows(overlay, [1, 2, 3, 4, 5], NAMES);

    it('ranks the ops the list keeps', () => {
        expect(getMarkedHotOpRanks(all, { limit: 2, hideUnlinked: true })).toEqual(
            new Map([
                [2, 1],
                [3, 2],
            ]),
        );
    });

    it('includes the ops without perf data, unranked, once the list shows them', () => {
        expect(getMarkedHotOpRanks(all, { limit: null, hideUnlinked: false })).toEqual(
            new Map([
                [2, 1],
                [3, 2],
                [1, 3],
                [4, null],
                [5, null],
            ]),
        );
    });
});

describe('buildHotRankByNodeId', () => {
    const ranks = new Map<number, number | null>([
        [2, 1],
        [3, 2],
        [4, null],
    ]);
    const entry = (id: string, operationId: number, memberOperationIds?: number[]): OpGraphNodeIndexEntry => ({
        id,
        operationId,
        name: id,
        memberOperationIds,
    });
    const rankOf = (node: OpGraphNodeIndexEntry) => buildHotRankByNodeId(ranks, [node]).get(node.id);

    it('gives an op node its own rank', () => {
        expect(rankOf(entry('3', 3))).toBe(2);
    });

    it('leaves out a node whose op the list does not show', () => {
        expect(buildHotRankByNodeId(ranks, [entry('1', 1)]).has('1')).toBe(false);
    });

    it('marks a listed op without perf data, unranked', () => {
        expect(rankOf(entry('4', 4))).toBeNull();
    });

    it("gives a folded block its slowest listed member's rank", () => {
        expect(rankOf(entry('block:1', 1, [1, 4, 3, 2]))).toBe(1);
        expect(rankOf(entry('block:4', 4, [4, 3]))).toBe(2);
    });

    it('keeps a ranked member over an unranked one listed after it', () => {
        expect(rankOf(entry('block:2', 2, [2, 4]))).toBe(1);
    });

    it('marks a folded block whose listed members have no perf data, unranked', () => {
        expect(rankOf(entry('block:4', 4, [4, 5]))).toBeNull();
    });

    it('leaves out a folded block with no listed member', () => {
        expect(buildHotRankByNodeId(ranks, [entry('block:1', 1, [1, 5])]).has('block:1')).toBe(false);
    });
});
