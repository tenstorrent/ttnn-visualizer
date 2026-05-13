// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/* eslint-disable no-continue */
import { pushTo } from './mlirGraphHelpers';
import type { SourceNode } from './mlirGraphTypes';

/**
 * Splits a set of nodes into communities ("super-groups") with low inter-community
 * edge-cut, using a hand-rolled implementation of the Louvain modularity-optimisation
 * algorithm (Blondel et al. 2008). The graph is treated as undirected; multi-edges
 * become weights.
 *
 * Compared to a fixed-size DFS bucketer, this produces groups that actually
 * correspond to densely-connected sub-regions, with sparse links between groups —
 * matching the mental model of "few edges in/out per group." Communities that
 * exceed `maxSize` are recursively re-partitioned up to `maxDepth` times so a
 * single dominant community doesn't swallow the entire graph.
 */

export type PartitionOptions = {
    /** Communities larger than this are recursively re-partitioned. Default: 800. */
    maxSize?: number;
    /** Communities smaller than this are merged into their best-connected neighbour. Default: 8. */
    minSize?: number;
    /** Hard cap on the number of TOP-LEVEL super-groups; smaller communities are greedily merged into their best-connected neighbour until the count is met. 0 disables. Default: 0. */
    targetK?: number;
    /**
     * Resolution parameter γ for the modularity objective (Reichardt-Bornholdt).
     * γ = 1 is the classic Louvain. γ < 1 produces fewer, LARGER communities (penalty for joining a large community is reduced). γ > 1 produces more, smaller ones.
     * Default: 1.0.
     */
    resolution?: number;
    /** Maximum recursion depth when splitting oversized communities. Default: 2. */
    maxDepth?: number;
    /** Maximum Louvain levels per partition pass. Default: 8. */
    maxLevels?: number;
    /** Maximum local-moving passes per Louvain level. Default: 16. */
    maxLocalPasses?: number;
};

const DEFAULT_OPTS: Required<PartitionOptions> = {
    maxSize: 800,
    minSize: 8,
    targetK: 0,
    resolution: 1.0,
    maxDepth: 2,
    maxLevels: 8,
    maxLocalPasses: 16,
};

type WeightedNeighbour = { idx: number; weight: number };

type Adjacency = {
    n: number;
    /** For each node, weighted neighbour list. Each undirected edge appears in BOTH endpoints' lists. */
    neighbours: WeightedNeighbour[][];
    /** Self-loop weight per node. By Newman convention, self-loops contribute 2× to the node degree. */
    selfLoops: Float64Array;
    /** Sum of incident weights per node, with self-loops counted twice. (Σ_j A_ij in matrix form.) */
    degree: Float64Array;
    /** Total edge weight m, where Σ_ij A_ij = 2m. Equals (unique undirected edge weight) + (self-loop weight). */
    m: number;
};

/**
 * Public entry. Partition `nodes` into community-coherent buckets.
 * Returns null when nodes.length ≤ threshold or when no meaningful split was found.
 */
export function partitionByCommunity(
    nodes: SourceNode[],
    threshold: number,
    options: PartitionOptions = {},
): SourceNode[][] | null {
    if (nodes.length <= threshold) {
        return null;
    }
    const opts: Required<PartitionOptions> = { ...DEFAULT_OPTS, ...options };
    const buckets = partitionRecursively(nodes, opts, 0);
    return buckets.length > 1 ? buckets : null;
}

function partitionRecursively(nodes: SourceNode[], opts: Required<PartitionOptions>, depth: number): SourceNode[][] {
    const adj = buildAdjacencyFromSources(nodes);
    if (adj.n === 0 || adj.m === 0) {
        return [nodes];
    }

    const communityByIndex = louvain(adj, opts);
    let groups = groupNodesByCommunity(nodes, communityByIndex);

    if (groups.size < 2) {
        return [nodes];
    }

    if (opts.minSize > 1) {
        groups = mergeTinyCommunities(groups, communityByIndex, adj, opts.minSize);
    }

    // Cap the super-group count at the top level. Inner recursion runs
    // unconstrained so we can still find natural sub-structure within an
    // oversized community.
    if (depth === 0 && opts.targetK > 0 && groups.size > opts.targetK) {
        groups = mergeUntilTargetK(groups, communityByIndex, adj, opts.targetK);
    }

    // Largest first so visual hierarchy reads top-to-bottom by importance.
    const sortedGroups = [...groups.values()].sort((a, b) => b.length - a.length);

    const buckets: SourceNode[][] = [];
    for (const community of sortedGroups) {
        if (community.length > opts.maxSize && depth + 1 < opts.maxDepth) {
            const sub = partitionRecursively(community, opts, depth + 1);
            buckets.push(...(sub.length > 1 ? sub : [community]));
        } else {
            buckets.push(community);
        }
    }
    return buckets;
}

function groupNodesByCommunity(nodes: SourceNode[], communityByIndex: Int32Array): Map<number, SourceNode[]> {
    const groups = new Map<number, SourceNode[]>();
    for (let i = 0; i < nodes.length; i++) {
        pushTo(groups, communityByIndex[i], nodes[i]);
    }
    return groups;
}

/** Build an undirected weighted adjacency from SourceNode.incomingEdges. Multi-edges accumulate. */
function buildAdjacencyFromSources(nodes: SourceNode[]): Adjacency {
    const idToIndex = new Map<string, number>();
    nodes.forEach((node, idx) => idToIndex.set(node.id, idx));
    const n = nodes.length;

    const sparse: Array<Map<number, number>> = Array.from({ length: n }, () => new Map());
    const selfLoops = new Float64Array(n);
    let m = 0;

    for (const node of nodes) {
        const t = idToIndex.get(node.id);
        if (t === undefined) {
            continue;
        }
        for (const edge of node.incomingEdges ?? []) {
            const s = idToIndex.get(edge.sourceNodeId);
            if (s === undefined) {
                continue;
            }
            if (s === t) {
                selfLoops[t] += 1;
                m += 1;
                continue;
            }
            sparse[s].set(t, (sparse[s].get(t) ?? 0) + 1);
            sparse[t].set(s, (sparse[t].get(s) ?? 0) + 1);
            m += 1;
        }
    }

    const neighbours: WeightedNeighbour[][] = sparse.map((map) =>
        [...map.entries()].map(([idx, weight]) => ({ idx, weight })),
    );

    const degree = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        let d = 0;
        for (const nb of neighbours[i]) {
            d += nb.weight;
        }
        d += 2 * selfLoops[i];
        degree[i] = d;
    }

    return { n, neighbours, selfLoops, degree, m };
}

/** Multi-level Louvain. Returns the community label of each ORIGINAL node index. */
function louvain(adj: Adjacency, opts: Required<PartitionOptions>): Int32Array {
    let currentAdj = adj;
    let mapping = new Int32Array(adj.n);
    for (let i = 0; i < adj.n; i++) {
        mapping[i] = i;
    }

    for (let level = 0; level < opts.maxLevels; level++) {
        const communityByIndex = new Int32Array(currentAdj.n);
        for (let i = 0; i < currentAdj.n; i++) {
            communityByIndex[i] = i;
        }

        const moved = localMoving(currentAdj, communityByIndex, opts.maxLocalPasses, opts.resolution);
        if (!moved) {
            break;
        }

        const renumber = new Map<number, number>();
        for (let i = 0; i < currentAdj.n; i++) {
            const c = communityByIndex[i];
            if (!renumber.has(c)) {
                renumber.set(c, renumber.size);
            }
            communityByIndex[i] = renumber.get(c)!;
        }

        // Propagate this level's assignment up to original node indices.
        const nextMapping = new Int32Array(adj.n);
        for (let i = 0; i < adj.n; i++) {
            nextMapping[i] = communityByIndex[mapping[i]];
        }
        mapping = nextMapping;

        // No merging happened (every super-node still solo) → converged.
        if (renumber.size === currentAdj.n) {
            break;
        }
        currentAdj = aggregate(currentAdj, communityByIndex, renumber.size);
    }

    return mapping;
}

/**
 * Phase 1 of Louvain. For each node, evaluate the modularity gain of moving it
 * to each neighbour's community, and pick the best (positive) move. Repeat until
 * a full pass produces no movement.
 *
 * Modularity gain for moving isolated node i into community C, with resolution
 * parameter γ (Reichardt-Bornholdt):
 *     ΔQ = k_{i,C}/m − γ · (Σtot_C · k_i) / (2m²)
 * where k_{i,C} is the sum of edge weights from i to nodes already in C,
 * Σtot_C is the sum of degrees in C (with i removed), m is the total edge weight,
 * and k_i is i's degree. γ = 1 recovers classic Louvain (Blondel et al. 2008,
 * eq. 2 simplified); γ < 1 favours larger communities (smaller penalty for
 * joining big ones); γ > 1 favours more, smaller communities.
 */
function localMoving(adj: Adjacency, communityByIndex: Int32Array, maxPasses: number, resolution: number): boolean {
    const { n, neighbours, degree, m } = adj;
    if (m === 0) {
        return false;
    }

    const sumTot = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        sumTot[communityByIndex[i]] += degree[i];
    }

    const twoMSquared = 2 * m * m;
    let anyMoved = false;

    for (let pass = 0; pass < maxPasses; pass++) {
        let movedThisPass = false;

        for (let i = 0; i < n; i++) {
            const ci = communityByIndex[i];
            const ki = degree[i];

            const weightToCommunity = new Map<number, number>();
            for (const { idx, weight } of neighbours[i]) {
                const cn = communityByIndex[idx];
                weightToCommunity.set(cn, (weightToCommunity.get(cn) ?? 0) + weight);
            }

            // Remove i from its current community before evaluating candidates.
            sumTot[ci] -= ki;

            // "Stay" (i in its current community, post-removal) is the ΔQ=0 baseline.
            let bestC = ci;
            let bestDelta = 0;

            for (const [cn, kIC] of weightToCommunity) {
                const delta = kIC / m - (resolution * sumTot[cn] * ki) / twoMSquared;
                if (delta > bestDelta + 1e-12) {
                    bestDelta = delta;
                    bestC = cn;
                }
            }

            sumTot[bestC] += ki;
            if (bestC !== ci) {
                communityByIndex[i] = bestC;
                movedThisPass = true;
                anyMoved = true;
            }
        }

        if (!movedThisPass) {
            break;
        }
    }

    return anyMoved;
}

/** Phase 2 of Louvain. Collapse each community into a super-node and re-build adjacency. */
function aggregate(adj: Adjacency, communityByIndex: Int32Array, k: number): Adjacency {
    const newSparse: Array<Map<number, number>> = Array.from({ length: k }, () => new Map());
    const newSelfLoops = new Float64Array(k);
    let newM = 0;

    for (let i = 0; i < adj.n; i++) {
        const ci = communityByIndex[i];

        // Each undirected edge (i, j) with i < j is processed exactly once.
        for (const { idx: j, weight } of adj.neighbours[i]) {
            if (j <= i) {
                continue;
            }
            const cj = communityByIndex[j];
            if (ci === cj) {
                newSelfLoops[ci] += weight;
            } else {
                newSparse[ci].set(cj, (newSparse[ci].get(cj) ?? 0) + weight);
                newSparse[cj].set(ci, (newSparse[cj].get(ci) ?? 0) + weight);
            }
            newM += weight;
        }

        newSelfLoops[ci] += adj.selfLoops[i];
        newM += adj.selfLoops[i];
    }

    const newNeighbours: WeightedNeighbour[][] = newSparse.map((map) =>
        [...map.entries()].map(([idx, weight]) => ({ idx, weight })),
    );

    const newDegree = new Float64Array(k);
    for (let c = 0; c < k; c++) {
        let d = 0;
        for (const nb of newNeighbours[c]) {
            d += nb.weight;
        }
        d += 2 * newSelfLoops[c];
        newDegree[c] = d;
    }

    return { n: k, neighbours: newNeighbours, selfLoops: newSelfLoops, degree: newDegree, m: newM };
}

/**
 * Tiny communities (< minSize members) typically read as visual noise once rendered
 * as their own super-group. Fold each tiny community into the larger neighbour it
 * shares the most edge weight with. Falls back to leaving it standalone if it has
 * no inter-community edges (truly isolated component).
 */
function mergeTinyCommunities(
    groups: Map<number, SourceNode[]>,
    communityByIndex: Int32Array,
    adj: Adjacency,
    minSize: number,
): Map<number, SourceNode[]> {
    const tiny = new Set<number>();
    for (const [c, members] of groups) {
        if (members.length < minSize) {
            tiny.add(c);
        }
    }
    if (tiny.size === 0 || tiny.size === groups.size) {
        return groups;
    }

    // Build a node-index map so we can look up adjacency by original node index.
    // adj is indexed identically to the input nodes array, so the SourceNode at
    // position i has community communityByIndex[i].
    const nodesByCommunity = new Map<number, number[]>();
    for (let i = 0; i < adj.n; i++) {
        pushTo(nodesByCommunity, communityByIndex[i], i);
    }

    const remap = new Map<number, number>();
    for (const tinyC of tiny) {
        const memberIndices = nodesByCommunity.get(tinyC) ?? [];
        const weightToOther = new Map<number, number>();
        for (const i of memberIndices) {
            for (const { idx, weight } of adj.neighbours[i]) {
                const cn = communityByIndex[idx];
                if (cn === tinyC || tiny.has(cn)) {
                    continue;
                }
                weightToOther.set(cn, (weightToOther.get(cn) ?? 0) + weight);
            }
        }
        let bestC: number | undefined;
        let bestWeight = -Infinity;
        for (const [cn, w] of weightToOther) {
            if (w > bestWeight) {
                bestWeight = w;
                bestC = cn;
            }
        }
        if (bestC !== undefined) {
            remap.set(tinyC, bestC);
        }
    }

    if (remap.size === 0) {
        return groups;
    }

    const merged = new Map<number, SourceNode[]>();
    for (const [c, members] of groups) {
        const target = remap.get(c) ?? c;
        const arr = merged.get(target);
        if (arr) {
            arr.push(...members);
        } else {
            merged.set(target, [...members]);
        }
    }
    return merged;
}

/**
 * Hard-cap the number of communities at `targetK` by greedily merging the
 * smallest community into its strongest-connected non-isolated neighbour, one
 * at a time, until the count is met. Inter-community edge weights are
 * incrementally maintained so each iteration is fast.
 *
 * This is post-Louvain, so it's not modularity-optimal — but for "user wants
 * ~10 super-groups" it gets the cross-cut right by absorbing the lowest-impact
 * splits first.
 */
function mergeUntilTargetK(
    groups: Map<number, SourceNode[]>,
    communityByIndex: Int32Array,
    adj: Adjacency,
    targetK: number,
): Map<number, SourceNode[]> {
    if (groups.size <= targetK) {
        return groups;
    }

    // Build inter-community edge weights from the original adjacency.
    const interEdges = new Map<number, Map<number, number>>();
    const ensure = (c: number): Map<number, number> => {
        let m = interEdges.get(c);
        if (!m) {
            m = new Map();
            interEdges.set(c, m);
        }
        return m;
    };
    for (let i = 0; i < adj.n; i++) {
        const ci = communityByIndex[i];
        for (const { idx, weight } of adj.neighbours[i]) {
            if (idx <= i) {
                continue;
            }
            const cj = communityByIndex[idx];
            if (ci === cj) {
                continue;
            }
            const a = ensure(ci);
            a.set(cj, (a.get(cj) ?? 0) + weight);
            const b = ensure(cj);
            b.set(ci, (b.get(ci) ?? 0) + weight);
        }
    }

    const working = new Map<number, SourceNode[]>();
    for (const [c, members] of groups) {
        working.set(c, [...members]);
    }

    while (working.size > targetK) {
        // Smallest community wins (lowest absorption cost).
        let smallestC = -1;
        let smallestSize = Infinity;
        for (const [c, members] of working) {
            if (members.length < smallestSize) {
                smallestSize = members.length;
                smallestC = c;
            }
        }
        if (smallestC === -1) {
            break;
        }

        // Pick the neighbour it shares the most edge weight with.
        let bestC = -1;
        let bestWeight = -Infinity;
        for (const [cn, w] of interEdges.get(smallestC) ?? []) {
            if (cn !== smallestC && working.has(cn) && w > bestWeight) {
                bestWeight = w;
                bestC = cn;
            }
        }

        // Isolated community (no edges to anything else) — fall back to merging
        // into the next-smallest community so we still hit targetK.
        if (bestC === -1) {
            let fallbackSize = Infinity;
            for (const [c, members] of working) {
                if (c !== smallestC && members.length < fallbackSize) {
                    fallbackSize = members.length;
                    bestC = c;
                }
            }
            if (bestC === -1) {
                break;
            }
        }

        // Merge members.
        const mergedMembers = [...(working.get(bestC) ?? []), ...(working.get(smallestC) ?? [])];
        working.set(bestC, mergedMembers);
        working.delete(smallestC);

        // Redirect smallestC's inter-community edges into bestC.
        const smallEdges = interEdges.get(smallestC) ?? new Map<number, number>();
        const bestEdges = ensure(bestC);
        for (const [cn, w] of smallEdges) {
            if (cn === bestC) {
                continue;
            }
            bestEdges.set(cn, (bestEdges.get(cn) ?? 0) + w);
            const cnEdges = interEdges.get(cn);
            if (cnEdges) {
                cnEdges.delete(smallestC);
                cnEdges.set(bestC, (cnEdges.get(bestC) ?? 0) + w);
            }
        }
        bestEdges.delete(smallestC);
        interEdges.delete(smallestC);
    }

    return working;
}
