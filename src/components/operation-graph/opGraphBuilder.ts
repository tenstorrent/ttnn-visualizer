// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { DEALLOCATE_OP_NAME_LIST } from '../../definitions/Deallocate';
import {
    type LayoutInputEdge,
    estimateBlockNodeSize,
    estimateOpNodeSize,
    formatBlockMeta,
    layoutDeviceSubgraph,
    layoutOpGraph,
} from './opGraphLayout';
import { detectRepeatBlocks, sumOptional } from './opGraphRepeatBlocks';
import {
    type OpGraphBlockSummary,
    type OpGraphBuildOptions,
    type OpGraphBuiltGraph,
    type OpGraphDeviceSubgraph,
    OpGraphEdgeType,
    type OpGraphFlowEdge,
    type OpGraphFlowNode,
    OpGraphNodeType,
    type OpGraphSourceOperation,
    type RepeatBlockInstance,
    isExpandableOperation,
} from './opGraphTypes';

export interface CandidateEdge {
    source: number;
    target: number;
    label: string;
    tensorId: number;
}

const isDeallocate = (name: string): boolean => DEALLOCATE_OP_NAME_LIST.includes(name.toLowerCase());

export function collectCandidateEdges(operations: OpGraphSourceOperation[]): CandidateEdge[] {
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

export function getKeptOperations(
    operations: OpGraphSourceOperation[],
    hideDeallocate: boolean,
    // Connectivity is decided before the deallocate filter so hiding deallocate
    // ops cannot drop their neighbours or pull in ops that were always isolated.
    // Callers that already hold the candidate pass supply it: this is an
    // ops x outputs x consumers walk on the build hot path, and `buildOpGraph` and
    // the worker's detection step both used to pay for it again here.
    candidates: readonly CandidateEdge[] = collectCandidateEdges(operations),
): OpGraphSourceOperation[] {
    const connected = new Set<number>();
    for (const candidate of candidates) {
        connected.add(candidate.source);
        connected.add(candidate.target);
    }
    return operations.filter(
        (operation) => connected.has(operation.id) && !(hideDeallocate && isDeallocate(operation.name)),
    );
}

export function buildOpGraph(
    operations: OpGraphSourceOperation[],
    { hideDeallocate, deviceSubgraphs, expandedBlockIds = [], detectedBlocks: providedBlocks }: OpGraphBuildOptions,
): OpGraphBuiltGraph {
    const candidates = collectCandidateEdges(operations);

    const subgraphByOperationId = new Map<number, OpGraphDeviceSubgraph>(
        deviceSubgraphs.map((subgraph) => [subgraph.operationId, subgraph]),
    );

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

    const keptOperations = getKeptOperations(operations, hideDeallocate, candidates);
    const kept = new Set<number>(keptOperations.map((operation) => operation.id));

    const operationById = new Map<number, OpGraphSourceOperation>(
        keptOperations.map((operation) => [operation.id, operation]),
    );
    const detectedBlocks = providedBlocks ?? detectRepeatBlocks(keptOperations);
    const expandedBlocks = new Set<string>(expandedBlockIds);
    const collapsedInstanceByOpId = new Map<number, RepeatBlockInstance>();
    for (const instance of detectedBlocks) {
        if (!expandedBlocks.has(instance.instanceId)) {
            for (const operationId of instance.operationIds) {
                collapsedInstanceByOpId.set(operationId, instance);
            }
        }
    }

    const renderedNodeIdOf = (operationId: number): string =>
        collapsedInstanceByOpId.get(operationId)?.instanceId ?? String(operationId);

    const nodes: OpGraphFlowNode[] = [];
    const deviceOpNodes: OpGraphFlowNode[] = [];
    const deviceOpEdges: OpGraphFlowEdge[] = [];
    const emittedBlockIds = new Set<string>();

    for (const operation of keptOperations) {
        const collapsedInstance = collapsedInstanceByOpId.get(operation.id);
        if (collapsedInstance !== undefined) {
            if (!emittedBlockIds.has(collapsedInstance.instanceId)) {
                emittedBlockIds.add(collapsedInstance.instanceId);
                const members = collapsedInstance.operationIds
                    .map((id) => operationById.get(id))
                    .filter((member): member is OpGraphSourceOperation => member !== undefined);
                const opCount = collapsedInstance.operationIds.length;
                const durationSeconds = sumOptional(members.map((member) => member.durationSeconds));
                const memoryDeltaBytes = sumOptional(members.map((member) => member.memoryDeltaBytes));
                const meta = formatBlockMeta(opCount, durationSeconds, memoryDeltaBytes);
                const size = estimateBlockNodeSize(collapsedInstance.label, meta);
                nodes.push({
                    id: collapsedInstance.instanceId,
                    type: OpGraphNodeType.BLOCK,
                    position: { x: 0, y: 0 },
                    ...size,
                    data: {
                        operationId: collapsedInstance.operationIds[0],
                        label: collapsedInstance.label,
                        fileIdentifier: meta,
                        filterString: collapsedInstance.label,
                        deviceOperationCount: 0,
                        blockInstanceId: collapsedInstance.instanceId,
                        memberNames: members.map((member) => member.name),
                        memberOperationIds: collapsedInstance.operationIds,
                        opCount,
                        durationSeconds,
                        memoryDeltaBytes,
                    },
                });
            }
        } else {
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
            } else {
                const childSizeById = new Map<string, { width: number; height: number }>(
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
    }

    const parallelCountByPair = new Map<string, number>();
    const layoutPairSeen = new Set<string>();
    const edges: OpGraphFlowEdge[] = [];
    // Ranking is between operations, so an edge that renders into an expanded node
    // still has to be handed to Dagre as reaching the node itself. Dagre drops edges
    // with endpoints it has no node for, which would silently lose the dependency
    // and flatten the two operations onto one rank.
    const layoutEdges: LayoutInputEdge[] = [];
    for (const candidate of candidates) {
        if (kept.has(candidate.source) && kept.has(candidate.target)) {
            const renderedSource = renderedNodeIdOf(candidate.source);
            const renderedTarget = renderedNodeIdOf(candidate.target);
            if (renderedSource !== renderedTarget) {
                const pair = `${renderedSource}->${renderedTarget}`;
                const sourceIsCollapsed = collapsedInstanceByOpId.has(candidate.source);
                const targetIsCollapsed = collapsedInstanceByOpId.has(candidate.target);
                // A folded block's boundary is the pair, not the tensors: N shapes
                // between the same two nodes are one dependency drawn N times.
                const isCollapsedBoundary = sourceIsCollapsed || targetIsCollapsed;
                if (!(isCollapsedBoundary && layoutPairSeen.has(pair))) {
                    const parallelIndex = parallelCountByPair.get(pair) ?? 0;
                    parallelCountByPair.set(pair, parallelIndex + 1);
                    edges.push({
                        id: `${candidate.source}-${candidate.target}-${parallelIndex}`,
                        source: sourceIsCollapsed ? renderedSource : exitNodeIdOf(candidate.source, candidate.tensorId),
                        target: targetIsCollapsed
                            ? renderedTarget
                            : entryNodeIdOf(candidate.target, candidate.tensorId),
                        type: OpGraphEdgeType.OP,
                        label: isCollapsedBoundary ? undefined : candidate.label,
                        data: {
                            parallelIndex,
                            sourceOperationId: candidate.source,
                            targetOperationId: candidate.target,
                        },
                    });
                    if (!layoutPairSeen.has(pair)) {
                        layoutPairSeen.add(pair);
                        layoutEdges.push({ source: renderedSource, target: renderedTarget });
                    }
                }
            }
        }
    }

    const positions = layoutOpGraph(
        nodes.map((node) => ({ id: node.id, width: node.width ?? 0, height: node.height ?? 0 })),
        layoutEdges,
    );

    const blocks: OpGraphBlockSummary[] = detectedBlocks.map((instance) => ({
        instanceId: instance.instanceId,
        operationIds: instance.operationIds,
        label: instance.label,
        patternLabel: instance.patternLabel,
        instanceIndex: instance.instanceIndex,
        instanceCount: instance.instanceCount,
    }));

    return {
        // Children last: React Flow resolves `parentId` against the nodes it has
        // already seen, and a child ahead of its parent renders at the pane origin.
        nodes: [
            ...nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })),
            ...deviceOpNodes,
        ],
        edges: [...edges, ...deviceOpEdges],
        blocks,
    };
}
