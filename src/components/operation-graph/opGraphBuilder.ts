// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { DEALLOCATE_OP_NAME_LIST } from '../../definitions/Deallocate';
import {
    type LayoutInputEdge,
    estimateBlockNodeSize,
    estimateOpNodeSize,
    layoutDeviceSubgraph,
    layoutOpGraph,
} from './opGraphLayout';
import { detectorFor } from './opGraphBlockDetectors';
import type { RememberedFan } from './opGraphWeightFans';
import { detectWeightFans, rememberedDecision, weightFanMembersCover, weightFanMembersOf } from './opGraphWeightFans';
import { formatBlockMeta } from './opGraphBlockMeta';
import { sumOptional } from '../../functions/math';
import { OpGraphBlockKind } from './opGraphTypes';
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

/**
 * One class per detector, so a reader can tell a repeated subgraph from a named layer
 * from a fan of weight loads at a glance. The colours themselves are `--graph-block-*`
 * tokens in `_base.scss`; nothing here knows a hex value. #1982
 */
const BLOCK_KIND_CLASS: Readonly<Record<OpGraphBlockKind, string>> = {
    [OpGraphBlockKind.REPEAT]: 'op-graph-block-repeat',
    [OpGraphBlockKind.LAYER]: 'op-graph-block-layer',
    [OpGraphBlockKind.WEIGHTS]: 'op-graph-block-weights',
};

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
    {
        hideDeallocate,
        deviceSubgraphs,
        expandedBlockIds,
        grouping,
        collapseWeightLoads,
        detectedBlocks: providedBlocks,
        candidates: providedCandidates,
    }: OpGraphBuildOptions,
): OpGraphBuiltGraph {
    const candidates = providedCandidates ?? collectCandidateEdges(operations);

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
    const detectedBlocks = providedBlocks ?? detectorFor(grouping)(keptOperations);
    // Detections are still reported when nothing has been folded, so the toolbar can
    // offer Fold; they are just not applied. Folding on first render decided for the
    // user, and it cannot be expressed as an id list because the ids only exist once
    // detection has run. #1977
    const hasFoldDecision = expandedBlockIds !== undefined;
    const expandedBlocks = new Set<string>(expandedBlockIds ?? []);
    const collapsedInstanceByOpId = new Map<number, RepeatBlockInstance>();
    for (const instance of detectedBlocks) {
        if (hasFoldDecision && !expandedBlocks.has(instance.instanceId)) {
            for (const operationId of instance.operationIds) {
                collapsedInstanceByOpId.set(operationId, instance);
            }
        }
    }

    const renderedNodeIdOf = (operationId: number): string =>
        collapsedInstanceByOpId.get(operationId)?.instanceId ?? String(operationId);

    // A weight load is a source: nothing that survived the filter feeds it. The same
    // test `detectWeightFans` opens with, and matched on shape rather than name for
    // its reason -- two of the local reports disagree about the name. Both ends kept,
    // so an edge from a hidden op does not count as feeding one.
    //
    // This counts weight-load *operations*, which is a superset of the ones that end
    // up in fans: a fan additionally needs a single consumer and at least two members,
    // so a source feeding two layers, or one with no partner, is counted here and
    // draws as a plain node when unrolled. On `bge_m3` that is 295 against 290 in
    // fans. Counting operations is the right answer for a block -- the question is
    // how much of this block is weight loading, not how much of it would pill up.
    const hasIncomingEdge = new Set<number>();
    for (const candidate of candidates) {
        if (kept.has(candidate.source) && kept.has(candidate.target)) {
            hasIncomingEdge.add(candidate.target);
        }
    }
    const weightLoadsIn = (operationIds: readonly number[]): number =>
        operationIds.reduce((count, id) => (hasIncomingEdge.has(id) ? count : count + 1), 0);

    // An unrolled fan's members are drawn, and keep their own edges and tensor labels —
    // that is what unrolling is for. They are just no longer top-level: they become
    // children of a container node, so Dagre has to rank the container in their place.
    // Hence two ids per operation, one for the edge and one for the layout. #2028
    const unrolledFanByOpId = new Map<number, RepeatBlockInstance>();
    const unrolledFanById = new Map<string, RepeatBlockInstance>();
    const layoutNodeIdOf = (operationId: number): string =>
        unrolledFanByOpId.get(operationId)?.instanceId ?? renderedNodeIdOf(operationId);

    // Added to the same map grouping uses, which is the whole integration: `renderedNodeIdOf`
    // then resolves a member to its fan, and the edge path below already suppresses the
    // label and dedupes parallel edges across a collapsed boundary. Detected here rather
    // than in a pre-pass because "the same rendered node" depends on what grouping just
    // folded. #1980
    if (collapseWeightLoads) {
        // Decoded once for the whole build, not per fan: the check below runs for
        // every fan, and parsing the id and allocating a set inside that loop made the
        // work grow with fans × remembered ids × membership. Kept as one entry per
        // remembered fan rather than collapsed to a union of members, because
        // containment is per fan and a union would be the bare intersection this
        // deliberately avoids.
        const rememberedFans: RememberedFan[] = [];
        for (const remembered of expandedBlocks) {
            const members = weightFanMembersOf(remembered);
            if (members !== null) {
                rememberedFans.push(rememberedDecision(members));
            }
        }
        const fans = detectWeightFans({
            keptOperations,
            candidates,
            kept,
            renderedNodeIdOf,
            isClaimed: (operationId) => collapsedInstanceByOpId.has(operationId),
        });
        for (const fan of fans) {
            // Unlike a grouping block, a fan's absence from the expansion set means
            // folded: the switch is on by default, so "no decision" is the folded state
            // rather than the unrolled one #1977 gives grouping. Without this the
            // expander pill rendered, incremented the set, and the fan folded anyway.
            // #1980
            //
            // Matched on membership as well as on the id, because a grouping fold can
            // merge two fans into one and the merged fan's id names neither of them.
            // The reader who opened either opened part of this one, so re-folding it
            // under them is the failure #1988 describes. Reading the remembered ids
            // for their members is why the id spells them out.
            const fanMemberSet = new Set(fan.operationIds);
            const wasUnrolled =
                expandedBlocks.has(fan.instanceId) ||
                rememberedFans.some((remembered) => weightFanMembersCover(remembered, fan.operationIds, fanMemberSet));
            if (!wasUnrolled) {
                for (const operationId of fan.operationIds) {
                    collapsedInstanceByOpId.set(operationId, fan);
                }
            } else {
                // Kept so the members can be drawn inside a container that carries the
                // fan's id, which is the only thing the reader can click to fold it
                // again. Recorded against the fan detected *this* build, not the
                // remembered id that matched it: a merge renames the fan, and folding
                // has to name what is on screen now. #2028
                for (const operationId of fan.operationIds) {
                    unrolledFanByOpId.set(operationId, fan);
                }
                unrolledFanById.set(fan.instanceId, fan);
            }
        }
    }

    const nodes: OpGraphFlowNode[] = [];
    const deviceOpNodes: OpGraphFlowNode[] = [];
    const deviceOpEdges: OpGraphFlowEdge[] = [];
    const emittedBlockIds = new Set<string>();

    // Built exactly as they would be at top level, then diverted: a member inside a
    // container is the same node, so nothing downstream that is keyed by node id --
    // perf styling, the critical path, focus, selection -- needs to know. #2028
    const fanMemberNodes = new Map<string, OpGraphFlowNode[]>();
    const nodesFor = (operationId: number): OpGraphFlowNode[] => {
        const fan = unrolledFanByOpId.get(operationId);
        if (fan === undefined) {
            return nodes;
        }
        const bucket = fanMemberNodes.get(fan.instanceId) ?? [];
        fanMemberNodes.set(fan.instanceId, bucket);
        return bucket;
    };

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
                // Not on a weight fan itself, where every member is one and the
                // count would restate the label. Only while the feature is on: with
                // it off the reader is not thinking in weight loads, and the word
                // would arrive unexplained.
                const meta = formatBlockMeta(
                    opCount,
                    durationSeconds,
                    memoryDeltaBytes,
                    collapseWeightLoads && collapsedInstance.kind !== OpGraphBlockKind.WEIGHTS
                        ? weightLoadsIn(collapsedInstance.operationIds)
                        : 0,
                );
                const size = estimateBlockNodeSize(collapsedInstance.label, meta);
                nodes.push({
                    id: collapsedInstance.instanceId,
                    type: OpGraphNodeType.BLOCK,
                    // Static, so it rides on the built node rather than being recomputed
                    // by the restyle memo on every selection and filter keystroke. #1982
                    className: BLOCK_KIND_CLASS[collapsedInstance.kind],
                    position: { x: 0, y: 0 },
                    ...size,
                    data: {
                        operationId: collapsedInstance.operationIds[0],
                        label: collapsedInstance.label,
                        // Not `fileIdentifier`: a block has no source file, and the
                        // stats line was being smuggled through the field that names
                        // one. The sums it is formatted from live on the summary.
                        fileIdentifier: '',
                        metaLine: meta,
                        filterString: collapsedInstance.label,
                        deviceOperationCount: 0,
                        blockInstanceId: collapsedInstance.instanceId,
                        blockKind: collapsedInstance.kind,
                        memberNames: members.map((member) => member.name),
                        memberOperationIds: collapsedInstance.operationIds,
                        opCount,
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
                nodesFor(operation.id).push({
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
                nodesFor(operation.id).push({
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

    // The container is sized from its members and is at least as wide as the pill it
    // replaces, so folding and unrolling do not jump the node's left edge around.
    for (const [instanceId, memberNodes] of fanMemberNodes) {
        // `fanMemberNodes` only gains a key when a member is routed into it, so an
        // entry always has both a fan and at least one node; the lookup narrows the
        // type rather than guarding against a state the loop above can produce.
        const fan = unrolledFanById.get(instanceId);
        if (fan !== undefined && memberNodes.length > 0) {
            const members = fan.operationIds
                .map((id) => operationById.get(id))
                .filter((member): member is OpGraphSourceOperation => member !== undefined);
            const opCount = fan.operationIds.length;
            const meta = formatBlockMeta(
                opCount,
                sumOptional(members.map((member) => member.durationSeconds)),
                sumOptional(members.map((member) => member.memoryDeltaBytes)),
            );
            // No edges between members: a fan is sources feeding one consumer, so they
            // have none by construction and Dagre lays them out on a single rank.
            const memberLayout = layoutDeviceSubgraph(
                memberNodes.map((member) => ({
                    id: member.id,
                    width: member.width ?? 0,
                    height: member.height ?? 0,
                })),
                [],
                estimateBlockNodeSize(fan.label, meta).width,
            );
            nodes.push({
                id: instanceId,
                type: OpGraphNodeType.WEIGHT_GROUP,
                className: BLOCK_KIND_CLASS[fan.kind],
                position: { x: 0, y: 0 },
                width: memberLayout.width,
                height: memberLayout.height,
                data: {
                    operationId: fan.operationIds[0],
                    label: fan.label,
                    fileIdentifier: '',
                    filterString: fan.label,
                    deviceOperationCount: 0,
                    metaLine: meta,
                    blockInstanceId: instanceId,
                    blockKind: fan.kind,
                    memberNames: members.map((member) => member.name),
                    memberOperationIds: fan.operationIds,
                    opCount,
                },
            });
            for (const member of memberNodes) {
                deviceOpNodes.push({
                    ...member,
                    parentId: instanceId,
                    extent: 'parent',
                    position: memberLayout.positions.get(member.id) ?? { x: 0, y: 0 },
                });
            }
        }
    }

    const parallelCountByPair = new Map<string, number>();
    const layoutPairSeen = new Set<string>();
    const layoutEdgeSeen = new Set<string>();
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
                        // Dagre only knows top-level nodes, so a member inside a fan
                        // container is ranked as the container. Several members of one
                        // fan feed the same consumer, which collapses to one layout
                        // edge — deduped separately from `pair`, which stays per member
                        // so each keeps its own edge and tensor label. #2028
                        const layoutSource = layoutNodeIdOf(candidate.source);
                        const layoutTarget = layoutNodeIdOf(candidate.target);
                        const layoutPair = `${layoutSource}->${layoutTarget}`;
                        if (layoutSource !== layoutTarget && !layoutEdgeSeen.has(layoutPair)) {
                            layoutEdgeSeen.add(layoutPair);
                            layoutEdges.push({ source: layoutSource, target: layoutTarget });
                        }
                    }
                }
            }
        }
    }

    const positions = layoutOpGraph(
        nodes.map((node) => ({ id: node.id, width: node.width ?? 0, height: node.height ?? 0 })),
        layoutEdges,
    );

    const blocks: OpGraphBlockSummary[] = detectedBlocks.map((instance) => {
        const members = instance.operationIds
            .map((id) => operationById.get(id))
            .filter((member): member is OpGraphSourceOperation => member !== undefined);
        return {
            instanceId: instance.instanceId,
            operationIds: instance.operationIds,
            label: instance.label,
            patternLabel: instance.patternLabel,
            instanceIndex: instance.instanceIndex,
            instanceCount: instance.instanceCount,
            durationSeconds: sumOptional(members.map((member) => member.durationSeconds)),
            memoryDeltaBytes: sumOptional(members.map((member) => member.memoryDeltaBytes)),
        };
    });

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
