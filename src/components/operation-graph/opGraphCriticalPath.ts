// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

interface CriticalPathNode {
    id: string;
    operationId: number;
}

interface CriticalPathEdge {
    id: string;
    source: string;
    target: string;
}

export interface CriticalPath {
    /** Source to sink. */
    opIds: number[];
    nodeIds: Set<string>;
    edgeIds: Set<string>;
    totalNs: number;
    /** The graph is meant to be acyclic; a cycle leaves part of it unvisited. */
    hasCycle: boolean;
}

export const EMPTY_CRITICAL_PATH: CriticalPath = {
    opIds: [],
    nodeIds: new Set<string>(),
    edgeIds: new Set<string>(),
    totalNs: 0,
    hasCycle: false,
};

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
    const inDegree = new Map<string, number>();
    for (const node of nodes) {
        opIdByNodeId.set(node.id, node.operationId);
        inDegree.set(node.id, 0);
    }

    const outgoingByNodeId = new Map<string, CriticalPathEdge[]>();
    for (const edge of edges) {
        // Both endpoints have to be in the node set: an edge to an op the build
        // dropped would otherwise leave a node permanently in-degree bound.
        if (inDegree.has(edge.source) && inDegree.has(edge.target)) {
            const outgoing = outgoingByNodeId.get(edge.source);
            if (outgoing === undefined) {
                outgoingByNodeId.set(edge.source, [edge]);
            } else {
                outgoing.push(edge);
            }
            inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
        }
    }

    const weightOf = (nodeId: string) => deviceTimeNsByOpId.get(opIdByNodeId.get(nodeId) ?? -1) ?? 0;

    const cost = new Map<string, number>();
    const opCount = new Map<string, number>();
    const predecessorByNodeId = new Map<string, string>();
    const predecessorEdgeByNodeId = new Map<string, string>();
    for (const node of nodes) {
        cost.set(node.id, weightOf(node.id));
        opCount.set(node.id, 1);
    }

    // Op id order rather than insertion order, so an unrelated change in build
    // order cannot silently pick a different path among equal-cost candidates.
    const byOpId = (left: string, right: string) => (opIdByNodeId.get(left) ?? 0) - (opIdByNodeId.get(right) ?? 0);
    const queue = nodes
        .filter((node) => inDegree.get(node.id) === 0)
        .map((node) => node.id)
        .sort(byOpId);

    let visited = 0;
    for (let head = 0; head < queue.length; head++) {
        const nodeId = queue[head];
        visited++;
        const nodeCost = cost.get(nodeId) ?? 0;
        const nodeOpCount = opCount.get(nodeId) ?? 1;

        for (const edge of outgoingByNodeId.get(nodeId) ?? []) {
            const candidateCost = nodeCost + weightOf(edge.target);
            const candidateOpCount = nodeOpCount + 1;
            const currentCost = cost.get(edge.target) ?? 0;
            const currentOpCount = opCount.get(edge.target) ?? 1;
            const currentPredecessor = predecessorByNodeId.get(edge.target);
            // Cost, then chain length, then op id. Length second so an equal-cost
            // tie reads as the fuller sequence rather than a prefix of it; op id
            // last so the pick can't move with build order.
            const isBetter =
                candidateCost > currentCost ||
                (candidateCost === currentCost && candidateOpCount > currentOpCount) ||
                (candidateCost === currentCost &&
                    candidateOpCount === currentOpCount &&
                    currentPredecessor !== undefined &&
                    byOpId(nodeId, currentPredecessor) < 0);
            if (isBetter) {
                cost.set(edge.target, candidateCost);
                opCount.set(edge.target, candidateOpCount);
                predecessorByNodeId.set(edge.target, nodeId);
                predecessorEdgeByNodeId.set(edge.target, edge.id);
            }

            const remaining = (inDegree.get(edge.target) ?? 0) - 1;
            inDegree.set(edge.target, remaining);
            if (remaining === 0) {
                queue.push(edge.target);
            }
        }
    }

    // Every node sits in a cycle, so nothing is ordered and no path is defined.
    if (queue.length === 0) {
        return { ...EMPTY_CRITICAL_PATH, hasCycle: true };
    }

    let endNodeId = queue[0];
    for (const nodeId of queue) {
        const costDelta = (cost.get(nodeId) ?? 0) - (cost.get(endNodeId) ?? 0);
        const opCountDelta = (opCount.get(nodeId) ?? 1) - (opCount.get(endNodeId) ?? 1);
        const isBetterEnd =
            costDelta > 0 ||
            (costDelta === 0 && opCountDelta > 0) ||
            (costDelta === 0 && opCountDelta === 0 && byOpId(nodeId, endNodeId) < 0);
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
        opIds.push(opIdByNodeId.get(nodeId) ?? -1);
        const edgeId = predecessorEdgeByNodeId.get(nodeId);
        if (edgeId !== undefined) {
            edgeIds.add(edgeId);
        }
        nodeId = predecessorByNodeId.get(nodeId);
    }
    opIds.reverse();

    return {
        opIds,
        nodeIds,
        edgeIds,
        totalNs: cost.get(endNodeId) ?? 0,
        hasCycle: visited < nodes.length,
    };
};
