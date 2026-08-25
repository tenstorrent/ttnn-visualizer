// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { isExtendedDeviceOperation } from '../../functions/filterOperations';
import { toReadableShape } from '../../functions/formatting';
import { type DeviceOperationNode, type Node, NodeType, type OperationDescription } from '../../model/APIData';
import type { OpGraphDeviceSubgraph } from './opGraphTypes';

// Namespaced because operation ids and device-frame ids are both bare numbers in
// unrelated id spaces. Without the prefix a child would collide with an operation
// node, and every overlay keyed by node id — perf styles, the critical path set —
// would score the wrong element. #1195
const DEVICE_NODE_PREFIX = 'dev';
const DEVICE_EDGE_PREFIX = 'dev-edge';

export const getDeviceNodeId = (operationId: number, frameId: number): string =>
    `${DEVICE_NODE_PREFIX}:${operationId}:${frameId}`;

export const getDeviceEdgeId = (
    operationId: number,
    sourceFrameId: number,
    targetFrameId: number,
    tensorId: number,
): string => `${DEVICE_EDGE_PREFIX}:${operationId}:${sourceFrameId}-${targetFrameId}:${tensorId}`;

const formatFrameLabel = (frame: DeviceOperationNode): string => `${frame.params.name}()`;

/**
 * `isExtendedDeviceOperation` rather than `isDeviceOperation`, so the `Tensor::`
 * frames are kept. They are the reshapes that bracket the device operations
 * proper, they consume and produce the operation's own boundary tensors, and
 * dropping them leaves the subgraph reading as a few disconnected kernels with
 * nowhere for the incoming edge to land.
 *
 * It admits unnamed frames though, and a node labelled `()` is noise, so the
 * emptiness check `isDeviceOperation` makes is kept.
 *
 * Both the badge count and the subgraph go through here: a count that disagrees
 * with what expanding produces is worse than either number alone. #1195
 */
const isDisplayedFrame = (frame: DeviceOperationNode): boolean =>
    frame.params.name !== '' && isExtendedDeviceOperation(frame.params.name);

const tensorRecordOf = (node: Node): { tensorId: number; shape: string | undefined } | null => {
    if (node.node_type !== NodeType.tensor) {
        return null;
    }
    const tensorId = Number(node.params.tensor_id);
    // `NaN` is one Map key: unreadable ids would share a bucket, invent edges,
    // and take the producer×consumer cross-product into a main-thread hang.
    if (!Number.isFinite(tensorId)) {
        return null;
    }
    return { tensorId, shape: node.params.shape };
};

const tensorIdsOf = (nodes: Node[] | undefined): number[] => {
    const tensorIds: number[] = [];
    for (const node of nodes ?? []) {
        const recorded = tensorRecordOf(node);
        if (recorded !== null) {
            tensorIds.push(recorded.tensorId);
        }
    }
    return tensorIds;
};

/**
 * How many device operations the graph would draw for this operation. Cheap
 * enough to run for every operation on report load — it is a name test over the
 * frames `processedConnections` has already resolved — unlike the subgraph itself,
 * which waits for expansion.
 */
export function countDeviceOperations(operation: OperationDescription): number {
    if (!Array.isArray(operation.processedConnections)) {
        return 0;
    }
    let count = 0;
    for (const frame of operation.processedConnections) {
        if (isDisplayedFrame(frame)) {
            count += 1;
        }
    }
    return count;
}

interface TensorHop {
    to: number;
    tensorId: number;
}

/**
 * Producer → consumer adjacency over **every** frame, not just the displayed
 * ones: two device operations are frequently joined only through intermediate
 * frames (`ttnn.`-prefixed or `::`-qualified) that the graph doesn't draw, and
 * dropping those first would sever the connection instead of shortening it.
 */
function collectTensorHops(frames: DeviceOperationNode[]): {
    hopsByFrameId: Map<number, TensorHop[]>;
    shapeByTensorId: Map<number, string>;
} {
    const shapeByTensorId = new Map<number, string>();
    const producersByTensorId = new Map<number, number[]>();
    const consumersByTensorId = new Map<number, number[]>();

    const record = (frameId: number, tensors: Node[], target: Map<number, number[]>) => {
        for (const tensor of tensors) {
            const recorded = tensorRecordOf(tensor);
            if (recorded !== null) {
                if (recorded.shape && !shapeByTensorId.has(recorded.tensorId)) {
                    shapeByTensorId.set(recorded.tensorId, recorded.shape);
                }
                const frameIds = target.get(recorded.tensorId);
                if (frameIds === undefined) {
                    target.set(recorded.tensorId, [frameId]);
                } else {
                    frameIds.push(frameId);
                }
            }
        }
    };

    for (const frame of frames) {
        record(frame.id, frame.outputs ?? [], producersByTensorId);
        record(frame.id, frame.inputs ?? [], consumersByTensorId);
    }

    const hopsByFrameId = new Map<number, TensorHop[]>();
    for (const [tensorId, producers] of producersByTensorId) {
        for (const from of producers) {
            for (const to of consumersByTensorId.get(tensorId) ?? []) {
                if (from !== to) {
                    const hops = hopsByFrameId.get(from);
                    if (hops === undefined) {
                        hopsByFrameId.set(from, [{ to, tensorId }]);
                    } else {
                        hops.push({ to, tensorId });
                    }
                }
            }
        }
    }

    return { hopsByFrameId, shapeByTensorId };
}

interface CompressedEdge {
    source: number;
    target: number;
    tensorId: number;
}

/**
 * Walks out from each displayed frame until it reaches another displayed one,
 * carrying the tensor the walk started on so the edge can still name what flows
 * along it. Visited is keyed by `(frame, tensor)` rather than frame alone: the
 * same intermediate frame legitimately relays two different tensors, and keying
 * on the frame would drop the second.
 */
function compressToDisplayedEdges(
    displayedFrameIds: ReadonlySet<number>,
    hopsByFrameId: ReadonlyMap<number, TensorHop[]>,
): CompressedEdge[] {
    const edges: CompressedEdge[] = [];
    const seen = new Set<string>();

    for (const start of displayedFrameIds) {
        const queue: Array<{ frameId: number; tensorId: number | null }> = [{ frameId: start, tensorId: null }];
        const visited = new Set<string>([`${start}:start`]);

        // Index pointer, not `shift()`: popping the head costs O(queue) and this
        // walk restarts for every displayed frame.
        for (let head = 0; head < queue.length; head++) {
            const current = queue[head];
            for (const hop of hopsByFrameId.get(current.frameId) ?? []) {
                const tensorId = current.tensorId ?? hop.tensorId;
                const visitKey = `${hop.to}:${tensorId}`;
                if (!visited.has(visitKey)) {
                    visited.add(visitKey);
                    if (displayedFrameIds.has(hop.to) && hop.to !== start) {
                        const edgeKey = `${start}->${hop.to}:${tensorId}`;
                        if (!seen.has(edgeKey)) {
                            seen.add(edgeKey);
                            edges.push({ source: start, target: hop.to, tensorId });
                        }
                    } else {
                        queue.push({ frameId: hop.to, tensorId });
                    }
                }
            }
        }
    }

    return edges;
}

/**
 * Drops an edge whose endpoints are already joined by a longer route, so a chain
 * of three device operations reads as a chain rather than a triangle. Only the
 * shortcut goes: the two-hop route carries the same dependency in more detail.
 */
function withoutShortcutEdges(edges: CompressedEdge[]): CompressedEdge[] {
    const targetsBySource = new Map<number, number[]>();
    for (const edge of edges) {
        const targets = targetsBySource.get(edge.source);
        if (targets === undefined) {
            targetsBySource.set(edge.source, [edge.target]);
        } else {
            targets.push(edge.target);
        }
    }

    // One BFS per source, not per edge: the compressed graph is the
    // producer×consumer cross-product, so a walk per edge was O(E·(V+E)).
    const reachableInTwoOrMoreHops = new Map<number, Set<number>>();
    for (const [source, firstHops] of targetsBySource) {
        const firstHopSet = new Set<number>(firstHops);
        const reachable = new Set<number>();
        const queue: number[] = [];
        const visited = new Set<number>([source]);
        for (const firstHop of firstHopSet) {
            visited.add(firstHop);
            queue.push(firstHop);
        }
        for (let head = 0; head < queue.length; head++) {
            const current = queue[head];
            for (const next of targetsBySource.get(current) ?? []) {
                if (!visited.has(next)) {
                    visited.add(next);
                    reachable.add(next);
                    queue.push(next);
                } else if (firstHopSet.has(next) && next !== current) {
                    reachable.add(next);
                }
            }
        }
        reachableInTwoOrMoreHops.set(source, reachable);
    }

    return edges.filter((edge) => !reachableInTwoOrMoreHops.get(edge.source)?.has(edge.target));
}

/**
 * The device operations an operation decomposes into, as a subgraph ready to
 * nest inside its node. Assembled on expansion rather than on report load: one
 * operation's frame stream runs to thousands of nodes, and deriving every
 * operation's subgraph up front would pay for the ones nobody opens.
 *
 * Returns `null` when nothing would be drawn, so the caller can leave the
 * operation collapsed rather than expanding it into an empty box.
 */
export function buildDeviceOperationSubgraph(operation: OperationDescription): OpGraphDeviceSubgraph | null {
    const frames = operation.processedConnections;
    if (!Array.isArray(frames) || frames.length === 0) {
        return null;
    }

    const displayedFrames = frames.filter(isDisplayedFrame);
    if (displayedFrames.length === 0) {
        return null;
    }

    const { hopsByFrameId, shapeByTensorId } = collectTensorHops(frames);
    const displayedFrameIds = new Set(displayedFrames.map((frame) => frame.id));
    const compressed = withoutShortcutEdges(compressToDisplayedEdges(displayedFrameIds, hopsByFrameId));

    // First writer wins for entries and last for exits, which for a tensor touched
    // more than once inside the operation picks the frame nearest the boundary in
    // frame order — the same order the subgraph is laid out in.
    const entryNodeIdByTensorId: Record<number, string> = {};
    const exitNodeIdByTensorId: Record<number, string> = {};
    for (const frame of displayedFrames) {
        const nodeId = getDeviceNodeId(operation.id, frame.id);
        for (const tensorId of tensorIdsOf(frame.inputs)) {
            if (entryNodeIdByTensorId[tensorId] === undefined) {
                entryNodeIdByTensorId[tensorId] = nodeId;
            }
        }
        for (const tensorId of tensorIdsOf(frame.outputs)) {
            exitNodeIdByTensorId[tensorId] = nodeId;
        }
    }

    // A frame that produces no tensor can be neither an end nor evidence that its
    // neighbour isn't. `Tensor::deallocate` consumes without producing, so treating
    // it as a source or a sink collapsed the unique-end fallback. #1195
    const producingFrameIds = new Set(
        displayedFrames.filter((frame) => tensorIdsOf(frame.outputs).length > 0).map((frame) => frame.id),
    );
    const framesWithIncoming = new Set(compressed.map((edge) => edge.target));
    const framesWithOutgoing = new Set(
        compressed.filter((edge) => producingFrameIds.has(edge.target)).map((edge) => edge.source),
    );
    const sources = displayedFrames.filter(
        (frame) => producingFrameIds.has(frame.id) && !framesWithIncoming.has(frame.id),
    );
    const sinks = displayedFrames.filter(
        (frame) => producingFrameIds.has(frame.id) && !framesWithOutgoing.has(frame.id),
    );

    return {
        operationId: operation.id,
        entryNodeIdByTensorId,
        exitNodeIdByTensorId,
        entryFallbackNodeId: sources.length === 1 ? getDeviceNodeId(operation.id, sources[0].id) : null,
        exitFallbackNodeId: sinks.length === 1 ? getDeviceNodeId(operation.id, sinks[0].id) : null,
        nodes: displayedFrames.map((frame) => ({
            id: getDeviceNodeId(operation.id, frame.id),
            label: formatFrameLabel(frame),
        })),
        edges: compressed.map((edge) => {
            const shape = shapeByTensorId.get(edge.tensorId);
            return {
                id: getDeviceEdgeId(operation.id, edge.source, edge.target, edge.tensorId),
                source: getDeviceNodeId(operation.id, edge.source),
                target: getDeviceNodeId(operation.id, edge.target),
                label: shape ? `T${edge.tensorId} ${toReadableShape(shape)}` : `T${edge.tensorId}`,
            };
        }),
    };
}
