import React, { useCallback, useEffect, useMemo } from 'react';
import ReactFlow, {
    Background,
    ConnectionLineType,
    Controls,
    Edge,
    MiniMap,
    Node,
    useEdgesState,
    useNodesState,
} from 'reactflow';
import 'reactflow/dist/style.css';

import ELK, { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk.bundled';
import { GraphBundle } from '../../model/MLIRJsonModel';

type MLNodeData = {
    label: string;
};
interface ViewProps {
    data: GraphBundle;
}
const elk = new ELK();

const elkOptions: Record<string, string> = {
    'elk.algorithm': 'layered',
    'elk.direction': 'DOWN',
    'elk.layered.spacing.nodeNodeBetweenLayers': '80',
    'elk.spacing.nodeNode': '40',

    'elk.layered.crossingMinimization.semiInteractive': 'true',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',

    'elk.edgeRouting': 'ORTHOGONAL', // or "SPLINES"
};

function toElkGraph(nodes: Node<MLNodeData>[], edges: Edge[]): ElkNode {
    return {
        id: 'root',
        layoutOptions: elkOptions,
        children: nodes.map((n) => ({
            id: n.id,
            width: n.width ?? 180,
            height: n.height ?? 48,
        })),
        edges: edges.map((e) => ({
            id: e.id,
            sources: [e.source],
            targets: [e.target],
        })) as ElkExtendedEdge[],
    };
}

async function layoutWithElk(
    nodes: Node<MLNodeData>[],
    edges: Edge[],
): Promise<{ nodes: Node<MLNodeData>[]; edges: Edge[] }> {
    const graph = toElkGraph(nodes, edges);
    const laidOut = await elk.layout(graph);

    const positions = new Map<string, { x: number; y: number }>();
    (laidOut.children ?? []).forEach((c: { id: string; x: never; y: never }) => {
        positions.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
    });

    const nextNodes = nodes.map((n) => {
        const p = positions.get(n.id) ?? { x: 0, y: 0 };
        return {
            ...n,
            position: p,

            draggable: true,
        };
    });

    return { nodes: nextNodes, edges };
}

const MlGraph: React.FC<ViewProps> = ({ data }) => {
    const graph = data.graphs[0];

    const getTensorInfoFromAttrs = (attrs: { key: string; value: string }[]) => {
        const shapeAttr =
            attrs.find((a) => a.key === 'shape') ||
            attrs.find((a) => a.key === 'tensor_shape') ||
            attrs.find((a) => a.key === 'dims');

        const dtypeAttr =
            attrs.find((a) => a.key === 'dtype') ||
            attrs.find((a) => a.key === 'element_type') ||
            attrs.find((a) => a.key === 'type');

        const shape = shapeAttr?.value;
        let dtype = dtypeAttr?.value;

        if (!dtype && shape?.includes('tensor<')) {
            const match = shape.match(/x([a-z0-9]+)>$/i);
            if (match) {
                // eslint-disable-next-line prefer-destructuring
                dtype = match[1];
            }
        }

        const cleanShape = (raw?: string) =>
            raw
                ?.replace(/^tensor</, '')
                ?.replace(/>$/, '')
                ?.replace(/x/g, '×');

        const prettyShape = cleanShape(shape);

        return {
            shape: prettyShape,
            dtype,
            label: prettyShape && dtype ? `${prettyShape} ${dtype}` : prettyShape || dtype,
        };
    };

    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

    const initialNodes: Node<MLNodeData>[] = graph.nodes.map((n) => ({
        id: n.id,
        data: { label: n.label },
        position: { x: 0, y: 0 },

        shape: 'box',
    }));

    const seen = new Set<string>();
    const initialEdges: Edge[] = [];

    for (const target of graph.nodes) {
        for (const e of target.incomingEdges ?? []) {
            const key = `${e.sourceNodeId}:${e.sourceNodeOutputId}->${target.id}:${e.targetNodeInputId}`;
            if (seen.has(key)) {
                // eslint-disable-next-line no-continue
                continue;
            }
            seen.add(key);

            const sourceNode = nodeMap.get(e.sourceNodeId);

            let shapeLabel: string | undefined;

            if (sourceNode) {
                const outputMeta = sourceNode.outputsMetadata?.find((m) => m.id === e.sourceNodeOutputId);

                if (outputMeta) {
                    const parsedAttrs = getTensorInfoFromAttrs(outputMeta.attrs);
                    shapeLabel = parsedAttrs.label;
                }
            }

            initialEdges.push({
                id: key,
                source: e.sourceNodeId,
                target: target.id,

                sourceHandle: e.sourceNodeOutputId,
                targetHandle: e.targetNodeInputId,

                label: shapeLabel || `${e.sourceNodeOutputId}→${e.targetNodeInputId}`,

                // type: "smoothstep",
                // animated: false,
                // markerEnd: { type: MarkerType.ArrowClosed },
                // data: { ... },
            });
        }
    }
    // const initialEdges = edges;

    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    const doLayout = useCallback(async () => {
        const { nodes: laidOutNodes, edges: laidOutEdges } = await layoutWithElk(nodes, edges);
        setNodes(laidOutNodes);
        setEdges(laidOutEdges);
    }, [nodes, edges, setNodes, setEdges]);

    useEffect(() => {
        // eslint-disable-next-line no-void
        void doLayout();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const nodeTypes = useMemo(() => ({}), []);

    return (
        <div style={{ width: '100%', height: '100vh' }}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                connectionLineType={ConnectionLineType.SmoothStep}
            >
                <MiniMap />
                <Controls />
                <Background />
            </ReactFlow>

            {/* eslint-disable-next-line react/button-has-type */}
            <button
                // eslint-disable-next-line no-void
                onClick={() => void doLayout()}
                style={{
                    position: 'absolute',
                    top: 12,
                    left: 12,
                    zIndex: 10,
                    padding: '8px 10px',
                }}
            >
                Re-layout (ELK)
            </button>
        </div>
    );
};

export default MlGraph;
