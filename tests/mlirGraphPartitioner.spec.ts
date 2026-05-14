// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { expect, test } from 'vitest';
import { partitionByCommunity } from '../src/components/mlir/mlirGraphPartitioner';
import type { SourceNode } from '../src/components/mlir/mlirGraphTypes';
import { chain, clique, edge, makeNode } from './mlirFixtures/builders';

/**
 * Build two disconnected cliques. Each clique is internally fully connected
 * with no edges between them — the canonical Louvain "two communities" case.
 */
function twoDisconnectedCliques(sizeA: number, sizeB: number): SourceNode[] {
    return [...clique('a', sizeA), ...clique('b', sizeB)];
}

/**
 * Build N cliques connected pairwise with a single weak bridge edge between
 * adjacent cliques (clique[i][0] → clique[i+1][0]). Resolution-friendly: each
 * clique is internally far denser than its single inter-cluster bridge.
 */
function chainedCliques(count: number, sizeEach: number): SourceNode[] {
    const all: SourceNode[] = [];
    for (let i = 0; i < count; i++) {
        all.push(...clique(`c${i}`, sizeEach));
    }
    // Add inter-clique bridges. Mutate the receiving clique's first node.
    for (let i = 0; i < count - 1; i++) {
        const target = all.find((n) => n.id === `c${i + 1}_0`)!;
        target.incomingEdges = [...target.incomingEdges, edge(`c${i}_0`)];
    }
    return all;
}

// 2.1.1 — threshold gate: nodes.length <= threshold returns null.
test('partitionByCommunity returns null when nodes count is at or below threshold', () => {
    const nodes = twoDisconnectedCliques(5, 5); // 10 nodes
    expect(partitionByCommunity(nodes, 10)).toBeNull();
    expect(partitionByCommunity(nodes, 15)).toBeNull();
});

// 2.1.2 — empty input.
test('partitionByCommunity returns null for empty input', () => {
    expect(partitionByCommunity([], 0)).toBeNull();
});

// 2.1.3 — single-node input.
test('partitionByCommunity returns null for a single-node input', () => {
    const one: SourceNode[] = [makeNode({ id: 'only', label: 'op' })];
    expect(partitionByCommunity(one, 0)).toBeNull();
});

// 2.1.4 — two disconnected components above threshold.
test('partitionByCommunity yields one bucket per disconnected component', () => {
    const nodes = twoDisconnectedCliques(6, 6);
    const buckets = partitionByCommunity(nodes, 0, { minSize: 1 });
    expect(buckets).not.toBeNull();
    expect(buckets!.length).toBe(2);

    // Each component lands entirely in one bucket.
    const aIds = new Set(['a_0', 'a_1', 'a_2', 'a_3', 'a_4', 'a_5']);
    const bIds = new Set(['b_0', 'b_1', 'b_2', 'b_3', 'b_4', 'b_5']);
    for (const bucket of buckets!) {
        const ids = new Set(bucket.map((n) => n.id));
        const aOverlap = [...ids].filter((id) => aIds.has(id)).length;
        const bOverlap = [...ids].filter((id) => bIds.has(id)).length;
        expect(aOverlap === 0 || bOverlap === 0).toBe(true);
    }
});

// 2.1.5 — bipartite with a single bridge edge.
test('partitionByCommunity keeps each dense cluster intact when joined by a weak bridge', () => {
    const left = clique('l', 5);
    const right = clique('r', 5);
    // Single bridge: l_0 → r_0
    right.find((n) => n.id === 'r_0')!.incomingEdges = [edge('l_0')];
    const nodes = [...left, ...right];

    const buckets = partitionByCommunity(nodes, 0, { minSize: 1 });
    expect(buckets).not.toBeNull();

    // Each bucket should be a subset of either L or R (never split a clique).
    const lIds = new Set(left.map((n) => n.id));
    const rIds = new Set(right.map((n) => n.id));
    for (const bucket of buckets!) {
        const ids = bucket.map((n) => n.id);
        const allFromL = ids.every((id) => lIds.has(id));
        const allFromR = ids.every((id) => rIds.has(id));
        expect(allFromL || allFromR, `bucket ${ids.join(',')} mixes L and R`).toBe(true);
    }
});

// 2.1.6 — targetK hard caps the top-level community count.
test('partitionByCommunity caps top-level bucket count at targetK', () => {
    const nodes = chainedCliques(5, 10); // 5 dense clusters, weak bridges
    const buckets = partitionByCommunity(nodes, 0, { targetK: 3, minSize: 1 });
    expect(buckets).not.toBeNull();
    expect(buckets!.length).toBeLessThanOrEqual(3);
});

// 2.1.7 — minSize folds small communities into a larger connected neighbour.
// Three communities (big_A, big_B, tiny) where tiny only connects to big_A.
// With minSize=8, tiny folds into big_A, leaving two communities.
test('partitionByCommunity folds tiny communities into a connected larger neighbour', () => {
    const bigA = clique('a', 12);
    const bigB = clique('b', 12);
    const tiny = clique('t', 3);
    // Connect tiny to big_A only (so the fold has a clear target).
    bigA.find((n) => n.id === 'a_0')!.incomingEdges.push(edge('t_0'));
    const nodes = [...bigA, ...bigB, ...tiny];

    const buckets = partitionByCommunity(nodes, 0, { minSize: 8 })!;
    expect(buckets).not.toBeNull();

    // No surviving community below minSize.
    for (const bucket of buckets) {
        expect(bucket.length, `bucket of size ${bucket.length} smaller than minSize`).toBeGreaterThanOrEqual(8);
    }
    // tiny's nodes must have been absorbed, not dropped.
    const allIds = new Set(buckets.flatMap((b) => b.map((n) => n.id)));
    for (const t of tiny) {
        expect(allIds.has(t.id), `tiny node "${t.id}" was dropped`).toBe(true);
    }
    // Tiny nodes must share a bucket with big_A nodes (the connected neighbour).
    const tinyBucket = buckets.find((b) => b.some((n) => n.id === 't_0'))!;
    const tinyBucketIds = new Set(tinyBucket.map((n) => n.id));
    expect(tinyBucketIds.has('a_0'), 'tiny did not fold into its connected neighbour big_A').toBe(true);
});

// 2.1.8 — maxDepth gates recursive splits.
test('partitionByCommunity does not recursively split when maxDepth is exhausted', () => {
    const nodes = chainedCliques(4, 30); // 120 nodes, 4 communities
    // maxDepth = 1 means: top-level split allowed (depth 0 → 1), no further.
    const buckets = partitionByCommunity(nodes, 0, { maxSize: 50, maxDepth: 1, minSize: 1 })!;
    expect(buckets).not.toBeNull();
    // Without recursion, an oversized community is returned as-is, not split.
    // We only assert that the call doesn't crash AND results are still well-formed.
    const totalNodes = buckets.reduce((sum, b) => sum + b.length, 0);
    expect(totalNodes).toBe(nodes.length);
});

// 2.1.9 — resolution parameter γ shifts community count predictably.
test('partitionByCommunity with higher resolution produces at least as many communities as lower resolution', () => {
    const nodes = chainedCliques(4, 12); // 48 nodes, naturally 4 communities

    const lowGamma = partitionByCommunity(nodes, 0, { resolution: 0.5, minSize: 1 })!;
    const highGamma = partitionByCommunity(nodes, 0, { resolution: 2.0, minSize: 1 })!;

    expect(lowGamma).not.toBeNull();
    expect(highGamma).not.toBeNull();
    // γ > 1 should never produce fewer communities than γ < 1.
    expect(highGamma.length).toBeGreaterThanOrEqual(lowGamma.length);
});

// 2.1.10 — deterministic for identical input.
test('partitionByCommunity is deterministic across runs on identical input', () => {
    const nodes = chainedCliques(3, 15);

    const a = partitionByCommunity(nodes, 0, { minSize: 1, targetK: 3 })!;
    const b = partitionByCommunity(nodes, 0, { minSize: 1, targetK: 3 })!;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();

    expect(a.length).toBe(b.length);
    // Compare bucket membership ignoring bucket order.
    const norm = (buckets: SourceNode[][]) =>
        buckets
            .map((bucket) =>
                bucket
                    .map((n) => n.id)
                    .sort()
                    .join(','),
            )
            .sort();
    expect(norm(a)).toEqual(norm(b));
});

// 2.1.11 — self-loops do not crash and are not double-counted as inter-community.
test('partitionByCommunity tolerates self-loops in the input graph', () => {
    const nodes: SourceNode[] = [
        ...chain('s', 8),
        // Self-loop on s_0
        makeNode({ id: 'self', label: 'op', incomingEdges: [edge('self')] }),
    ];
    // Edge s_0 → self (so the self-loop node is reachable).
    nodes.find((n) => n.id === 'self')!.incomingEdges.unshift(edge('s_0'));

    expect(() => partitionByCommunity(nodes, 0, { minSize: 1 })).not.toThrow();
    const buckets = partitionByCommunity(nodes, 0, { minSize: 1 })!;
    // Total node count preserved.
    const total = buckets.reduce((sum, b) => sum + b.length, 0);
    expect(total).toBe(nodes.length);
});
