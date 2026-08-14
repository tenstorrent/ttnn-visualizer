// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { Edge, Node } from '@xyflow/react';
import type { NodeRelation } from '../../definitions/NodeRelation';

export enum OpGraphNodeType {
    OP = 'opNode',
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
}

export interface OpGraphSourceOutput {
    /** Already run through `toReadableShape`, so the worker needs no formatters. */
    edgeLabel: string;
    consumers: number[];
}

export type OpGraphNodeData = {
    operationId: number;
    label: string;
    fileIdentifier: string;
    filterString: string;
    highlight?: NodeRelation;
};

export type OpGraphEdgeData = {
    /** 0 for the first edge of a `(source, target)` pair, 1 for its twin. */
    parallelIndex: number;
};

export type OpGraphFlowNode = Node<OpGraphNodeData, OpGraphNodeType.OP>;
export type OpGraphFlowEdge = Edge<OpGraphEdgeData, OpGraphEdgeType.OP>;

export interface OpGraphBuiltGraph {
    nodes: OpGraphFlowNode[];
    edges: OpGraphFlowEdge[];
}

export interface OpGraphBuildOptions {
    hideDeallocate: boolean;
    compact: boolean;
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
