// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { Edge, Node } from '@xyflow/react';
import type { NodeRelation } from '../../definitions/NodeRelation';

export enum OpGraphNodeType {
    OP = 'opNode',
    /** An operation showing its device operations: same node, nested body. */
    DEVICE_GROUP = 'deviceGroupNode',
    /** One device operation, parented to the operation it belongs to. */
    DEVICE_OP = 'deviceOpNode',
    /** A collapsed repeat-window instance. #1583 */
    BLOCK = 'blockNode',
}

export enum OpGraphEdgeType {
    OP = 'opEdge',
}

export enum OpGraphWorkerMessageType {
    SET_GRAPH = 'set-graph',
    BUILD = 'build',
    BUILT = 'built',
    ERROR = 'error',
}

// Only what layout needs: the full operation list would clone every tensor's
// dtype, layout and memory config to the worker on each report change.
export interface OpGraphSourceOperation {
    id: number;
    name: string;
    fileIdentifier: string;
    outputs: OpGraphSourceOutput[];
    /**
     * Drives the expander badge. Counted by `countDeviceOperations`, which shares a
     * predicate with the subgraph so the badge cannot promise a number expanding
     * contradicts. Not `deviceOperationNameList` from `fetchOperations`: that is
     * built through `isDeviceOperation`, a deliberately narrower predicate.
     */
    deviceOperationCount: number;
    /** Fingerprint inputs for repeat detection. Absent in older test fixtures. */
    inputShapes?: string[];
    durationSeconds?: number;
    memoryDeltaBytes?: number;
}

// A single device operation expands into one node with no edges, which says
// nothing the badge hasn't already said — and on a report where most operations
// decompose into exactly one, the badges are the clutter. #1195
const MIN_EXPANDABLE_DEVICE_OPERATIONS = 2;

export const isExpandableOperation = (deviceOperationCount: number): boolean =>
    deviceOperationCount >= MIN_EXPANDABLE_DEVICE_OPERATIONS;

export interface OpGraphSourceOutput {
    /** Already run through `toReadableShape`, so the worker needs no formatters. */
    edgeLabel: string;
    consumers: number[];
    /** Identifies which device operation an edge reaches inside an expanded node. */
    tensorId: number;
}

// One data shape for both kinds, discriminated by the node's `type`. A device
// operation carries the id of the operation it belongs to, so selecting or
// hovering a child answers with its parent rather than with nothing.
export type OpGraphNodeData = {
    operationId: number;
    label: string;
    fileIdentifier: string;
    filterString: string;
    /** 0 when the operation decomposes into nothing the graph would draw. */
    deviceOperationCount: number;
    highlight?: NodeRelation;
    blockInstanceId?: string;
    memberNames?: string[];
    memberOperationIds?: number[];
    opCount?: number;
    /** A block's stats line. Its sums live on `OpGraphBlockSummary`. */
    metaLine?: string;
    buriedMatchCount?: number;
};

export type OpGraphEdgeData = {
    /** 0 for the first edge of a `(source, target)` pair, 1 for its twin. */
    parallelIndex: number;
    // An endpoint may be a device operation nested inside the operation it belongs
    // to, so the operation an edge really joins is carried rather than read off the
    // endpoint id. Everything reasoning about graph topology — the I/O highlight,
    // the critical path, the filter's edge exemption — uses these, and so reads the
    // same whether either end is expanded. #1195
    sourceOperationId: number;
    targetOperationId: number;
};

export type OpGraphFlowNode = Node<OpGraphNodeData, OpGraphNodeType>;
export type OpGraphFlowEdge = Edge<OpGraphEdgeData, OpGraphEdgeType.OP>;

/**
 * A device-operation subgraph, assembled on the main thread when its operation is
 * expanded and shipped with the build request. Ids arrive already namespaced, so
 * the builder places them without knowing how they were derived.
 */
export interface OpGraphDeviceSubgraph {
    operationId: number;
    nodes: { id: string; label: string }[];
    edges: { id: string; source: string; target: string; label: string }[];
    /**
     * Where an edge carrying a given tensor crosses the boundary. An incoming edge
     * lands on the device operation that consumes its tensor and an outgoing one
     * leaves the device operation that produced it, so an expanded node reads as
     * part of the dataflow rather than as a box the arrows stop at.
     */
    entryNodeIdByTensorId: Record<number, string>;
    exitNodeIdByTensorId: Record<number, string>;
    /**
     * Used when a boundary tensor is claimed by no drawn frame, which is the
     * common case on the way out: the operation's own result is registered by the
     * enclosing `ttnn.` frame rather than by the device operation that computed
     * it. A single source or sink is then the only place the edge could attach,
     * so it is a rename rather than a guess. `null` when there is more than one,
     * where anything but the boundary would be inventing a connection.
     */
    entryFallbackNodeId: string | null;
    exitFallbackNodeId: string | null;
}

export interface RepeatBlockInstance {
    instanceId: string;
    patternId: string;
    label: string;
    patternLabel: string;
    operationIds: number[];
    instanceIndex: number;
    instanceCount: number;
}

export interface OpGraphBlockSummary {
    instanceId: string;
    operationIds: number[];
    label: string;
    patternLabel: string;
    instanceIndex: number;
    instanceCount: number;
    // Summed once here rather than re-derived by the panel: the node's meta line
    // and the panel's stats are on screen together, so two derivations show up as
    // the two of them disagreeing about one block. #1944
    durationSeconds: number;
    memoryDeltaBytes: number;
}

export interface OpGraphBuiltGraph {
    nodes: OpGraphFlowNode[];
    edges: OpGraphFlowEdge[];
    blocks?: OpGraphBlockSummary[];
}

// Rebuilt only when the worker delivers a graph, in canvas order. The filter and
// prev/next walk this instead of the React Flow `nodes` array, which gets a fresh
// identity on every drag frame.
export interface OpGraphNodeIndexEntry {
    id: string;
    operationId: number;
    name: string;
    memberNames?: string[];
    memberOperationIds?: number[];
}

export interface OpGraphBuildOptions {
    hideDeallocate: boolean;
    /** Only the expanded operations, so a collapsed graph carries no payload. */
    deviceSubgraphs: OpGraphDeviceSubgraph[];
    /** Empty means every detected instance is collapsed. #1583 */
    expandedBlockIds?: readonly string[];
    /** Worker-only: detection is invariant under fold / device-op expand. */
    detectedBlocks?: RepeatBlockInstance[];
}

export type OpGraphWorkerInboundMessage =
    | {
          type: OpGraphWorkerMessageType.SET_GRAPH;
          sourceVersion: number;
          operations: OpGraphSourceOperation[];
      }
    | ({
          type: OpGraphWorkerMessageType.BUILD;
          sourceVersion: number;
          requestId: number;
      } & OpGraphBuildOptions);

export type OpGraphWorkerOutboundMessage =
    | {
          type: OpGraphWorkerMessageType.BUILT;
          sourceVersion: number;
          requestId: number;
          graph: OpGraphBuiltGraph;
      }
    | {
          type: OpGraphWorkerMessageType.ERROR;
          requestId: number;
          error: string;
      };
