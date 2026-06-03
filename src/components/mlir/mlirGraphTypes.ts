// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

/** Shared between MLIR React Flow view and mlirLayoutWorker (minimal graph index + build payloads). */

export type IndexedEdge = {
    sourceNodeId: string;
    sourceNodeOutputId: string;
    targetNodeInputId: string;
};

/**
 * Outgoing-edge view used to render consumers ("Outputs") for a selected node
 * in the details panel. Derived from the rendered React Flow edges rather
 * than the raw source data — terminator ops like `stablehlo.return` have
 * synthesised outgoing connections that the layout worker emits but that
 * never round-trip through the source data's `incomingEdges`. `label` is the
 * tensor shape that the edge carries on the canvas (e.g. "[7, 3072] bf16"),
 * when present.
 */
export type OutgoingEdge = {
    targetNodeId: string;
    /** Consumer op label (e.g. "stablehlo.reshape"). null when the target node is unknown to the source-data index. */
    targetNodeLabel: string | null;
    sourceNodeOutputId: string;
    targetNodeInputId: string;
    label?: string;
};

/**
 * Incoming-edge view used to render producers ("Inputs") for a selected node
 * in the details panel. Derived from the rendered React Flow edges (same
 * basis as OutgoingEdge), plus the producer's `outputsMetadata` for the
 * corresponding source port — that's the tensor metadata that flows along
 * the wire (`shape`, `dtype`, `__tensor_tag`, …). When the producer doesn't
 * declare metadata for that port, `sourcePortMetadata` is null and the row
 * shows just the source id + port + label.
 */
export type IncomingEdgeView = {
    sourceNodeId: string;
    /** Producer op label (e.g. "stablehlo.add"). null when the source node is unknown to the source-data index. */
    sourceNodeLabel: string | null;
    sourceNodeOutputId: string;
    targetNodeInputId: string;
    label?: string;
    sourcePortMetadata: IndexedPortMetadata | null;
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

export type SourceNode = {
    id: string;
    label: string;
    namespace: string;
    attrs: IndexedAttr[];
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
    /** Return/output node id per namespace (e.g. stablehlo.return). */
    namespaceReturnNodeByNamespace: Record<string, string>;
    containingNamespacesByNodeId: Record<string, string[]>;
    /** Outer region op node id → collapsible inner namespace (parent-level toggle). */
    outerNamespaceByNodeId: Record<string, string>;
    /** Namespaces created by topology-aware sectioning (artificial groups). */
    sectionNamespaces: string[];
};

export type WorkerNode = {
    id: string;
    type?: string;
    parentId?: string;
    extent?: 'parent';
    draggable?: boolean;
    /** CSS selector that constrains where the node can be dragged from (e.g. group header). */
    dragHandle?: string;
    position: { x: number; y: number };
    width?: number;
    height?: number;
    data: {
        label: string;
        kind?: 'op' | 'group';
        namespace: string;
        collapsedSubgraphNamespace?: string;
        subgraphToggleState?: 'collapsed' | 'expanded';
        /** Group headers: human-readable group name (e.g. "section 1 of 7", "Inputs"). */
        displayName?: string;
        /** Group headers: total count of nodes inside this group (descendants included). */
        nodeCount?: number;
        /** Group headers: classification used for header iconography/tooltips. */
        groupKind?: 'section' | 'plain';
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
    type?: string;
    pathOptions?: { offset?: number; curvature?: number };
    labelShowBg?: boolean;
    labelBgStyle?: Record<string, unknown>;
    labelBgPadding?: [number, number];
    labelBgBorderRadius?: number;
    labelStyle?: Record<string, unknown>;
    markerEnd?: { type: string; height: number; width: number };
    style?: Record<string, unknown>;
};

export type BuiltGraph = { nodes: WorkerNode[]; edges: WorkerEdge[] };

export type SetGraphMessage = {
    type: 'set-graph';
    graphId: string;
    nodes: SourceNode[];
};

export type BuildMessage = {
    type: 'build';
    requestId: number;
    graphId: string;
    expandedNamespaces: string[];
    cacheKey: string;
};

export type WorkerInboundMessage = SetGraphMessage | BuildMessage;

export type WorkerBuiltMessage = {
    type: 'built';
    requestId: number;
    graphId: string;
    cacheKey: string;
    graph: BuiltGraph;
};

export type WorkerErrorMessage = {
    type: 'error';
    requestId: number;
    error: string;
};

export type WorkerInteractionIndex = {
    anchorByNamespace: Record<string, string>;
    anchorNamespaceByNodeId: Record<string, string>;
    outerNamespaceByNodeId: Record<string, string>;
    /** Return / terminator node id per namespace (e.g. stablehlo.return). */
    namespaceReturnNodeByNamespace: Record<string, string>;
    /**
     * Per-namespace inner input-arg node ids, indexed by the outer op's
     * input port. Used to reverse the layout worker's input remapping —
     * cross-region edges targeting the outer op are rendered as targeting
     * `namespaceInputByNamespace[ns][portIdx]`, so the panel needs this map
     * to attribute those edges back to the outer op's input port.
     */
    namespaceInputByNamespace: Record<string, string[]>;
};

export type WorkerIndexedMessage = {
    type: 'indexed';
    graphId: string;
    interactionIndex: WorkerInteractionIndex;
};

export type WorkerOutboundMessage = WorkerBuiltMessage | WorkerErrorMessage | WorkerIndexedMessage;
