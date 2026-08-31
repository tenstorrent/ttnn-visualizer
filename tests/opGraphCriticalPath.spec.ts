// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';

import { findCriticalPath } from '../src/components/operation-graph/opGraphCriticalPath';

// Node ids are `String(operationId)`, as `opGraphBuilder` emits them.
const nodes = (...operationIds: number[]) =>
    operationIds.map((operationId) => ({ id: String(operationId), operationId }));

const edgeId = (source: number, target: number, parallelIndex = 0) => `${source}-${target}-${parallelIndex}`;

const edges = (...pairs: [source: number, target: number][]) =>
    pairs.map(([source, target]) => ({ id: edgeId(source, target), source: String(source), target: String(target) }));

const weights = (...pairs: [opId: number, deviceTimeNs: number][]) => new Map<number, number>(pairs);

describe('findCriticalPath', () => {
    it('walks a linear chain and sums every op on it', () => {
        const path = findCriticalPath(nodes(1, 2, 3), edges([1, 2], [2, 3]), weights([1, 100], [2, 200], [3, 300]));

        expect(path.opIds).toEqual([1, 2, 3]);
        expect(path.opCount).toBe(3);
        expect(path.totalNs).toBe(600);
        expect([...path.edgeIds]).toEqual(expect.arrayContaining([edgeId(1, 2), edgeId(2, 3)]));
        expect(path.hasCycle).toBe(false);
        // The set the view actually reads: node outlines, the container dim and
        // the annotation are all gated on `nodeIds.size`, so correct `opIds`
        // beside an empty `nodeIds` would disable the feature silently.
        expect([...path.nodeIds].sort()).toEqual(['1', '2', '3']);
    });

    it('prefers two sequential ops over one heavier op on a side branch', () => {
        // The case the plain perf ramp can't show: 10 + 10 sequential costs more
        // wall clock than a single 15 beside it, even though 15 is the hotter op.
        const path = findCriticalPath(
            nodes(1, 2, 3, 4, 5),
            edges([1, 2], [2, 3], [3, 5], [1, 4], [4, 5]),
            weights([2, 10], [3, 10], [4, 15]),
        );

        expect(path.opIds).toEqual([1, 2, 3, 5]);
        expect(path.totalNs).toBe(20);
    });

    it('breaks a tie between equal-cost branches on the lower op id', () => {
        const path = findCriticalPath(
            nodes(1, 2, 3, 4),
            edges([1, 2], [2, 4], [1, 3], [3, 4]),
            weights([2, 10], [3, 10]),
        );

        expect(path.opIds).toEqual([1, 2, 4]);
        expect(path.totalNs).toBe(10);
        // The losing branch must be absent from what gets outlined, not merely
        // absent from `opIds`.
        expect([...path.nodeIds].sort()).toEqual(['1', '2', '4']);
    });

    it('picks the same branch whichever order the edges arrive in', () => {
        // Guards the tie-break against build order: the branch through op 2 has to
        // win even when op 3's edges are relaxed first.
        const path = findCriticalPath(
            nodes(1, 2, 3, 4),
            edges([1, 3], [3, 4], [1, 2], [2, 4]),
            weights([2, 10], [3, 10]),
        );

        expect(path.opIds).toEqual([1, 2, 4]);
    });

    it('picks the same branch whichever order the sources arrive in', () => {
        // Two zero-indegree sources converging on one sink, so reversing the node
        // list actually reverses the order Kahn seeds. A fixture with one source
        // cannot: the seed is that node either way, whatever the list does.
        //
        // Ops 1 and 2 cost the same and both reach op 3 in one hop, so the sink's
        // predecessor is settled by the op-id tie-break alone — drop it and the
        // reversed run answers [2, 3].
        const converging = edges([1, 3], [2, 3]);
        const equalCost = weights([1, 10], [2, 10], [3, 5]);
        const forwards = findCriticalPath(nodes(1, 2, 3), converging, equalCost);
        const backwards = findCriticalPath(nodes(3, 2, 1), converging, equalCost);

        expect(forwards.opIds).toEqual([1, 3]);
        expect(backwards.opIds).toEqual(forwards.opIds);
        expect(backwards.totalNs).toBe(forwards.totalNs);
        expect(backwards.edgeIds).toEqual(forwards.edgeIds);
    });

    it('crosses an op with no perf row as a zero-cost pass-through', () => {
        // A gap in the report shortens the total rather than severing the path.
        const path = findCriticalPath(nodes(1, 2, 3), edges([1, 2], [2, 3]), weights([1, 100], [3, 100]));

        expect(path.opIds).toEqual([1, 2, 3]);
        expect(path.totalNs).toBe(200);
    });

    it('prefers the longer chain when two paths cost the same', () => {
        // Both routes to op 4 cost 10; the three-op one describes the sequence.
        const path = findCriticalPath(nodes(1, 2, 3, 4), edges([1, 2], [2, 4], [3, 4]), weights([2, 10], [3, 10]));

        expect(path.opIds).toEqual([1, 2, 4]);
    });

    it('counts a parallel edge pair once and still reaches the target', () => {
        // `opGraphBuilder` emits twin edges for two tensors between the same ops;
        // double-counting their in-degree would strand the target unvisited.
        const twins = [
            { id: edgeId(1, 2, 0), source: '1', target: '2' },
            { id: edgeId(1, 2, 1), source: '1', target: '2' },
        ];
        const path = findCriticalPath(nodes(1, 2), twins, weights([1, 10], [2, 20]));

        expect(path.opIds).toEqual([1, 2]);
        expect(path.totalNs).toBe(30);
        expect(path.edgeIds.size).toBe(1);
        expect(path.hasCycle).toBe(false);
    });

    it('ignores an edge from an op the build dropped', () => {
        // Op 3 was filtered out; counting its edge would hold op 2 in-degree bound
        // forever and read as a cycle.
        const dangling = { id: edgeId(3, 2), source: '3', target: '2' };
        const path = findCriticalPath(nodes(1, 2), [...edges([1, 2]), dangling], weights([1, 10], [2, 20]));

        expect(path.opIds).toEqual([1, 2]);
        expect(path.totalNs).toBe(30);
        expect(path.hasCycle).toBe(false);
    });

    it('flags a cycle and returns the path through the acyclic part', () => {
        const path = findCriticalPath(
            nodes(1, 2, 3, 4),
            edges([1, 2], [3, 4], [4, 3]),
            weights([1, 50], [2, 50], [3, 1_000], [4, 1_000]),
        );

        expect(path.hasCycle).toBe(true);
        expect(path.opIds).toEqual([1, 2]);
        expect(path.totalNs).toBe(100);
    });

    it('flags a cycle and defines no path when every op sits in one', () => {
        const path = findCriticalPath(nodes(1, 2), edges([1, 2], [2, 1]), weights([1, 10], [2, 10]));

        expect(path.hasCycle).toBe(true);
        expect(path.opIds).toEqual([]);
        expect(path.totalNs).toBe(0);
    });

    it('picks the heaviest op when nothing is connected', () => {
        // The single-node branch the view's `hasCriticalPath` nulling exists for:
        // one op, no edges, and the outline still has to land on it.
        const path = findCriticalPath(nodes(1, 2, 3), [], weights([1, 10], [2, 50], [3, 20]));

        expect(path.opIds).toEqual([2]);
        expect(path.nodeIds).toEqual(new Set(['2']));
        expect(path.edgeIds.size).toBe(0);
        expect(path.totalNs).toBe(50);
        expect(path.hasCycle).toBe(false);
    });

    it('returns an empty path for an empty graph', () => {
        const path = findCriticalPath([], [], weights());

        expect(path.opIds).toEqual([]);
        expect(path.edgeIds.size).toBe(0);
        expect(path.totalNs).toBe(0);
        expect(path.hasCycle).toBe(false);
        expect(path.opCount).toBe(0);
    });

    it('weights a folded block by the sum of its members', () => {
        const path = findCriticalPath(
            [
                { id: '1', operationId: 1 },
                { id: 'block:0:2', operationId: 2, memberOperationIds: [2, 3, 4] },
                { id: '5', operationId: 5 },
            ],
            [
                { id: '1-2-0', source: '1', target: 'block:0:2' },
                { id: '2-5-0', source: 'block:0:2', target: '5' },
            ],
            weights([1, 10], [2, 100], [3, 100], [4, 100], [5, 10]),
        );

        expect(path.nodeIds.has('block:0:2')).toBe(true);
        expect(path.totalNs).toBe(320);
        expect(path.opCount).toBe(5);
    });
});
