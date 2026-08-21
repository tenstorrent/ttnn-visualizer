// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { DEALLOCATE_OP_NAME_LIST } from '../../definitions/Deallocate';
import { type LayoutInputEdge, estimateOpNodeSize, layoutDeviceSubgraph, layoutOpGraph } from './opGraphLayout';
import {
    type OpGraphBuildOptions,
    type OpGraphBuiltGraph,
    OpGraphEdgeType,
    type OpGraphFlowEdge,
    type OpGraphFlowNode,
    OpGraphNodeType,
    type OpGraphSourceOperation,
    isExpandableOperation,
} from './opGraphTypes';

interface CandidateEdge {
    source: number;
    target: number;
    label: string;
    tensorId: number;
}

const isDeallocate = (name: string): boolean => DEALLOCATE_OP_NAME_LIST.includes(name.toLowerCase());

function collectCandidateEdges(operations: OpGraphSourceOperation[]): CandidateEdge[] {
    const candidates: CandidateEdge[] = [];
    for (const operation of operations) {
        for (const output of operation.outputs) {
            for (const consumer of output.consumers) {
                candidates.push({
                    source: operation.id,
                    target: consumer,
                    label: output.edgeLabel,
                    tensorId: output.tensorId,
                });
            }
        }
    }
    return candidates;
}

export function buildOpGraph(
    operations: OpGraphSourceOperation[],
    { hideDeallocate, deviceSubgraphs }: OpGraphBuildOptions,
): OpGraphBuiltGraph {
    const candidates = collectCandidateEdges(operations);

    // Connectivity is decided before the deallocate filter so hiding deallocate
    // ops cannot drop their neighbours or pull in ops that were always isolated.
    const connected = new Set<number>();
    for (const candidate of candidates) {
        connected.add(candidate.source);
        connected.add(candidate.target);
    }

    const subgraphByOperationId = new Map(deviceSubgraphs.map((subgraph) => [subgraph.operationId, subgraph]));

    // Reach past the boundary of an expanded operation to the device operation that
    // produces or consumes the tensor, so the edge joins the dataflow instead of
    // stopping at the box. Both fall back to the operation's own node: an endpoint
    // that resolved to a node the graph doesn't hold would drop the edge silently.
    const exitNodeIdOf = (operationId: number, tensorId: number): string => {
        const subgraph = subgraphByOperationId.get(operationId);
        return subgraph?.exitNodeIdByTensorId[tensorId] ?? subgraph?.exitFallbackNodeId ?? String(operationId);
    };
    const entryNodeIdOf = (operationId: number, tensorId: number): string => {
        const subgraph = subgraphByOperationId.get(operationId);
        return subgraph?.entryNodeIdByTensorId[tensorId] ?? subgraph?.entryFallbackNodeId ?? String(operationId);
    };

    const kept = new Set<number>();
    const nodes: OpGraphFlowNode[] = [];
    const deviceOpNodes: OpGraphFlowNode[] = [];
    const deviceOpEdges: OpGraphFlowEdge[] = [];
    for (const operation of operations) {
        if (connected.has(operation.id) && !(hideDeallocate && isDeallocate(operation.name))) {
            kept.add(operation.id);
            const label = `${operation.id} ${operation.name}`;
            const collapsedSize = estimateOpNodeSize(
                label,
                operation.fileIdentifier,
                isExpandableOperation(operation.deviceOperationCount),
            );
            const data = {
                operationId: operation.id,
                label,
                fileIdentifier: operation.fileIdentifier,
                filterString: operation.name,
                deviceOperationCount: operation.deviceOperationCount,
            };
            const subgraph = subgraphByOperationId.get(operation.id);

            if (subgraph === undefined) {
                nodes.push({
                    id: String(operation.id),
                    type: OpGraphNodeType.OP,
                    position: { x: 0, y: 0 },
                    ...collapsedSize,
                    data,
                });
                // eslint-disable-next-line no-continue
                continue;
            }

            const childSizeById = new Map(
                subgraph.nodes.map((child) => [child.id, estimateOpNodeSize(child.label, '')]),
            );
            const childLayout = layoutDeviceSubgraph(
                subgraph.nodes.map((child) => ({ id: child.id, ...childSizeById.get(child.id)! })),
                subgraph.edges,
                collapsedSize.width,
            );

            // The operation keeps its node id when expanded. Everything keyed by
            // node id — the perf style patches, the critical path's node set, focus
            // and selection — then needs no notion of expansion at all, and the
            // edges already pointing here stay pointing here. #1195
            nodes.push({
                id: String(operation.id),
                type: OpGraphNodeType.DEVICE_GROUP,
                position: { x: 0, y: 0 },
                width: childLayout.width,
                height: childLayout.height,
                data,
            });

            for (const child of subgraph.nodes) {
                deviceOpNodes.push({
                    id: child.id,
                    type: OpGraphNodeType.DEVICE_OP,
                    parentId: String(operation.id),
                    extent: 'parent',
                    position: childLayout.positions.get(child.id) ?? { x: 0, y: 0 },
                    ...childSizeById.get(child.id)!,
                    data: {
                        operationId: operation.id,
                        label: child.label,
                        fileIdentifier: '',
                        filterString: child.label,
                        deviceOperationCount: 0,
                    },
                });
            }

            for (const edge of subgraph.edges) {
                deviceOpEdges.push({
                    id: edge.id,
                    source: edge.source,
                    target: edge.target,
                    type: OpGraphEdgeType.OP,
                    label: edge.label,
                    // Both ends are the same operation, which is what marks this as
                    // internal to it rather than a relation between two operations.
                    data: {
                        parallelIndex: 0,
                        sourceOperationId: operation.id,
                        targetOperationId: operation.id,
                    },
                });
            }
        }
    }

    const parallelCountByPair = new Map<string, number>();
    const edges: OpGraphFlowEdge[] = [];
    // Ranking is between operations, so an edge that renders into an expanded node
    // still has to be handed to Dagre as reaching the node itself. Dagre drops edges
    // with endpoints it has no node for, which would silently lose the dependency
    // and flatten the two operations onto one rank.
    const layoutEdges: LayoutInputEdge[] = [];
    for (const candidate of candidates) {
        if (kept.has(candidate.source) && kept.has(candidate.target)) {
            const pair = `${candidate.source}-${candidate.target}`;
            const parallelIndex = parallelCountByPair.get(pair) ?? 0;
            parallelCountByPair.set(pair, parallelIndex + 1);
            edges.push({
                id: `${pair}-${parallelIndex}`,
                source: exitNodeIdOf(candidate.source, candidate.tensorId),
                target: entryNodeIdOf(candidate.target, candidate.tensorId),
                type: OpGraphEdgeType.OP,
                label: candidate.label,
                data: {
                    parallelIndex,
                    sourceOperationId: candidate.source,
                    targetOperationId: candidate.target,
                },
            });
            layoutEdges.push({ source: String(candidate.source), target: String(candidate.target) });
        }
    }

    const positions = layoutOpGraph(
        nodes.map((node) => ({ id: node.id, width: node.width ?? 0, height: node.height ?? 0 })),
        layoutEdges,
    );

    return {
        // Children last: React Flow resolves `parentId` against the nodes it has
        // already seen, and a child ahead of its parent renders at the pane origin.
        nodes: [
            ...nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })),
            ...deviceOpNodes,
        ],
        edges: [...edges, ...deviceOpEdges],
    };
}
