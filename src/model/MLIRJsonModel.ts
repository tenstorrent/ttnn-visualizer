// Root
export interface GraphBundle {
    graphs: GraphDocument[];
}

export interface GraphDocument {
    id: string; // e.g. "stablehlo_sdy.mlir"
    nodes: GraphNode[];
}

// Core node
export interface GraphNode {
    id: string; // e.g. 'loc("-":4:12)__1' or 'input_0'
    label: string; // op name or arg name, e.g. "stablehlo.add" or "%arg42"
    namespace: string; // hierarchical grouping path
    subgraphIds: string[]; // present, often []
    attrs: KeyValueAttr[];

    incomingEdges: GraphEdge[];

    // Output ports described with per-port attrs (shape/dtype/tag/etc)
    outputsMetadata: PortMetadata[];

    // Present in file as [], but leave flexible for future
    inputsMetadata: PortMetadata[];

    style: NodeStyle | null;

    // Sometimes null, sometimes has { pinToGroupTop: boolean }
    config: NodeConfig | null;
}

export interface KeyValueAttr {
    key: string;
    value: string; // values are serialized strings in the JSON (even for arrays / numbers)
}

// Edge references ports by id (strings like "0", "1", "2")
export interface GraphEdge {
    sourceNodeId: string;
    sourceNodeOutputId: string;
    targetNodeInputId: string;
}

// Port metadata (for outputs and inputs)
export interface PortMetadata {
    id: string; // port id as string (e.g. "0", "1")
    attrs: KeyValueAttr[];
}

export interface NodeConfig {
    pinToGroupTop?: boolean;
}

export type NodeStyle = Record<string, unknown>;
