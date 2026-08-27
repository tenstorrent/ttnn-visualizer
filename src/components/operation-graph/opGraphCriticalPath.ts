// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

interface CriticalPathNode {
    id: string;
    operationId: number;
    memberOperationIds?: number[];
}

interface CriticalPathEdge {
    id: string;
    source: string;
    target: string;
}

// Every node id in `nodes` is registered before any lookup, so a miss is
// unreachable; the sentinel keeps the comparators total without an assertion.
const UNKNOWN_OP_ID = -1;

export interface CriticalPath {
    /** Source to sink. */
    opIds: number[];
    /** Member ops along the path; a folded block counts every member. */
    opCount: number;
    nodeIds: ReadonlySet<string>;
    edgeIds: ReadonlySet<string>;
    totalNs: number;
    /**
     * A cycle leaves its members and everything downstream of them unordered, so
     * the path covers the acyclic portion only and the total understates.
     */
    hasCycle: boolean;
}

export const EMPTY_CRITICAL_PATH: CriticalPath = {
    opIds: [],
    opCount: 0,
    nodeIds: new Set<string>(),
    edgeIds: new Set<string>(),
    totalNs: 0,
    hasCycle: false,
};

/**
 * Cost, then chain length, then op id. Length second so an equal-cost tie reads
 * as the fuller sequence rather than a prefix of it; op id last so the pick can't
 * move with build order. Both the relaxation guard and the end-node scan decide
 * through this one comparator, because determinism only holds while they agree.
 */
const isPreferredChain = (costDelta: number, opCountDelta: number, opIdDelta: number) =>
    costDelta > 0 || (costDelta === 0 && (opCountDelta > 0 || (opCountDelta === 0 && opIdDelta < 0)));

/**
 * Longest cumulative-duration path, where cost is carried by the ops and edges
 * are unweighted. An op with no perf row costs 0 and stays traversable, so a
 * gap in the report shortens the total rather than severing the path.
 */
export const findCriticalPath = (
    nodes: readonly CriticalPathNode[],
    edges: readonly CriticalPathEdge[],
    deviceTimeNsByOpId: ReadonlyMap<number, number>,
): CriticalPath => {
    if (nodes.length === 0) {
        return EMPTY_CRITICAL_PATH;
    }

    const opIdByNodeId = new Map<string, number>();
    const inDegreeByNodeId = new Map<string, number>();
    for (const node of nodes) {
        opIdByNodeId.set(node.id, node.operationId);
        inDegreeByNodeId.set(node.id, 0);
    }

    const outgoingByNodeId = new Map<string, CriticalPathEdge[]>();
    for (const edge of edges) {
        // Defensive: this function doesn't assume its inputs came from
        // `opGraphBuilder`, which already drops edges with a dropped endpoint. An
        // unmatched target would sit in-degree bound and read as a cycle.
        if (inDegreeByNodeId.has(edge.source) && inDegreeByNodeId.has(edge.target)) {
            const outgoing = outgoingByNodeId.get(edge.source);
            if (outgoing === undefined) {
                outgoingByNodeId.set(edge.source, [edge]);
            } else {
                outgoing.push(edge);
            }
            inDegreeByNodeId.set(edge.target, (inDegreeByNodeId.get(edge.target) ?? 0) + 1);
        }
    }

    const membersByNodeId = new Map<string, number[]>();
    for (const node of nodes) {
        membersByNodeId.set(node.id, node.memberOperationIds ?? [node.operationId]);
    }

    const weightOf = (nodeId: string) => {
        let total = 0;
        for (const operationId of membersByNodeId.get(nodeId) ?? []) {
            total += deviceTimeNsByOpId.get(operationId) ?? 0;
        }
        return total;
    };

    const costByNodeId = new Map<string, number>();
    const opCountByNodeId = new Map<string, number>();
    const predecessorByNodeId = new Map<string, string>();
    const predecessorEdgeByNodeId = new Map<string, string>();
    for (const node of nodes) {
        costByNodeId.set(node.id, weightOf(node.id));
        opCountByNodeId.set(node.id, membersByNodeId.get(node.id)?.length ?? 1);
    }

    const byOpId = (left: string, right: string) =>
        (opIdByNodeId.get(left) ?? UNKNOWN_OP_ID) - (opIdByNodeId.get(right) ?? UNKNOWN_OP_ID);

    // Sources in whatever order they arrive: the comparators below settle every
    // tie on op id, so the result doesn't depend on this order and sorting it
    // would be the one super-linear step in an otherwise O(V+E) pass.
    const topoOrder = nodes.filter((node) => inDegreeByNodeId.get(node.id) === 0).map((node) => node.id);

    for (let head = 0; head < topoOrder.length; head++) {
        const nodeId = topoOrder[head];
        const nodeCost = costByNodeId.get(nodeId) ?? 0;
        const nodeOpCount = opCountByNodeId.get(nodeId) ?? 1;

        for (const edge of outgoingByNodeId.get(nodeId) ?? []) {
            const candidateCost = nodeCost + weightOf(edge.target);
            const candidateOpCount = nodeOpCount + (membersByNodeId.get(edge.target)?.length ?? 1);
            const currentPredecessor = predecessorByNodeId.get(edge.target);
            const isBetter = isPreferredChain(
                candidateCost - (costByNodeId.get(edge.target) ?? 0),
                candidateOpCount - (opCountByNodeId.get(edge.target) ?? 1),
                // A target without a predecessor has no chain to compare op ids
                // against, and can't reach the op-id tie either: its own single op
                // is always shorter than the candidate chain arriving at it.
                currentPredecessor === undefined ? 0 : byOpId(nodeId, currentPredecessor),
            );
            if (isBetter) {
                costByNodeId.set(edge.target, candidateCost);
                opCountByNodeId.set(edge.target, candidateOpCount);
                predecessorByNodeId.set(edge.target, nodeId);
                predecessorEdgeByNodeId.set(edge.target, edge.id);
            }

            const remaining = (inDegreeByNodeId.get(edge.target) ?? 0) - 1;
            inDegreeByNodeId.set(edge.target, remaining);
            if (remaining === 0) {
                topoOrder.push(edge.target);
            }
        }
    }

    // Every node sits in a cycle, so nothing is ordered and no path is defined.
    if (topoOrder.length === 0) {
        return { ...EMPTY_CRITICAL_PATH, hasCycle: true };
    }

    let endNodeId = topoOrder[0];
    for (const nodeId of topoOrder) {
        const isBetterEnd = isPreferredChain(
            (costByNodeId.get(nodeId) ?? 0) - (costByNodeId.get(endNodeId) ?? 0),
            (opCountByNodeId.get(nodeId) ?? 1) - (opCountByNodeId.get(endNodeId) ?? 1),
            byOpId(nodeId, endNodeId),
        );
        if (isBetterEnd) {
            endNodeId = nodeId;
        }
    }

    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    const opIds: number[] = [];
    let nodeId: string | undefined = endNodeId;
    while (nodeId !== undefined) {
        nodeIds.add(nodeId);
        opIds.push(opIdByNodeId.get(nodeId) ?? UNKNOWN_OP_ID);
        const edgeId = predecessorEdgeByNodeId.get(nodeId);
        if (edgeId !== undefined) {
            edgeIds.add(edgeId);
        }
        nodeId = predecessorByNodeId.get(nodeId);
    }
    opIds.reverse();

    return {
        opIds,
        opCount: opCountByNodeId.get(endNodeId) ?? opIds.length,
        nodeIds,
        edgeIds,
        totalNs: costByNodeId.get(endNodeId) ?? 0,
        // Kahn only orders what it can reach, so a short order means a cycle held
        // its members back.
        hasCycle: topoOrder.length < nodes.length,
    };
};
