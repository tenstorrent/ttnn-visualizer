// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';

import { buildHotOpRows, getVisibleHotOpRows } from '../src/components/operation-graph/opGraphHotOps';
import { buildOpGraphPerfOverlay } from '../src/components/operation-graph/opGraphPerfOverlay';
import { HotOpsSort } from '../src/definitions/HotOps';
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

const ids = (list: { operationId: number }[]) => list.map((row) => row.operationId);

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

    it('does not reorder the rows it was given', () => {
        getVisibleHotOpRows(all, { limit: null, sort: HotOpsSort.OPERATION_ID, hideUnlinked: false });

        expect(ids(all)).toEqual([2, 3, 1, 4, 5]);
    });
});
