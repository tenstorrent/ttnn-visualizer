// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

/** Shared between MLIR React Flow view and mlirLayoutWorker (minimal graph index + build payloads). */

export type IndexedEdge = {
    sourceNodeId: string;
    sourceNodeOutputId: string;
    targetNodeInputId: string;
};

export type IndexedAttr = { key: string; value: string };
export type IndexedPortMetadata = { id: string; attrs: IndexedAttr[] };

export type IndexedNode = {
    id: string;
    label: string;
    namespace: string;
    incomingEdges: IndexedEdge[];
    outputsMetadata: IndexedPortMetadata[];
    config: { pinToGroupTop?: boolean } | null;
};

export type GraphIndex = {
    graphId: string;
    nodes: IndexedNode[];
    subgraphNamespaces: string[];
    anchorByNamespace: Record<string, string>;
    anchorNamespaceByNodeId: Record<string, string>;
    namespaceInputByNamespace: Record<string, string[]>;
    containingNamespacesByNodeId: Record<string, string[]>;
    /** Outer region op node id → collapsible inner namespace (parent-level toggle). */
    outerNamespaceByNodeId: Record<string, string>;
};

export type WorkerNode = {
    id: string;
    type?: string;
    parentId?: string;
    extent?: 'parent';
    draggable?: boolean;
    position: { x: number; y: number };
    width?: number;
    height?: number;
    data: {
        label: string;
        kind?: 'op' | 'group';
        namespace: string;
        collapsedSubgraphNamespace?: string;
        subgraphToggleState?: 'collapsed' | 'expanded';
    };
    style?: Record<string, unknown>;
};

export type WorkerEdge = {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    label?: string;
    markerEnd?: { type: string; height: number; width: number };
    style?: Record<string, unknown>;
};

export type BuiltGraph = { nodes: WorkerNode[]; edges: WorkerEdge[] };

export type SetIndexMessage = {
    type: 'set-index';
    graphId: string;
    index: GraphIndex;
};

export type BuildMessage = {
    type: 'build';
    requestId: number;
    graphId: string;
    expandedNamespaces: string[];
    cacheKey: string;
};

export type WorkerInboundMessage = SetIndexMessage | BuildMessage;

export type WorkerBuiltMessage = {
    type: 'built';
    requestId: number;
    cacheKey: string;
    graph: BuiltGraph;
};

export type WorkerErrorMessage = {
    type: 'error';
    requestId: number;
    error: string;
};

export type WorkerIndexedMessage = {
    type: 'indexed';
    graphId: string;
};

export type WorkerOutboundMessage = WorkerBuiltMessage | WorkerErrorMessage | WorkerIndexedMessage;
