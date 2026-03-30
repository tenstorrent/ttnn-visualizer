import React, { useCallback, useEffect, useMemo, useState } from 'react';
import 'styles/components/MLIRViewReactFlow.scss';
import ReactFlow, {
    Background,
    ConnectionLineType,
    Controls,
    Edge,
    MarkerType,
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
    kind?: 'op' | 'group';
    namespace?: string;
    collapsed?: boolean;
};
interface ViewProps {
    data: GraphBundle;
}
const elk = new ELK();

const elkOptions: Record<string, string> = {
    'elk.algorithm': 'layered',
    'elk.direction': 'DOWN',

    'elk.spacing.nodeNode': '24',
    'elk.layered.spacing.nodeNodeBetweenLayers': '120',
    'elk.spacing.edgeNode': '16',
    'elk.spacing.edgeEdge': '12',

    'elk.edgeRouting': 'ORTHOGONAL',

    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.layered.crossingMinimization.semiInteractive': 'false',

    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.layered.thoroughness': '10',

    'elk.layered.unnecessaryBendpoints': 'true',
    'elk.layered.mergeEdges': 'false',
    'elk.layered.cycleBreaking.strategy': 'GREEDY',
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
    (laidOut.children ?? []).forEach((c) => {
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

const getNamespaceSegments = (namespace?: string): string[] => (namespace ? namespace.split('/').filter(Boolean) : []);

const getShortName = (namespace: string): string => {
    const parts = getNamespaceSegments(namespace);
    return parts[parts.length - 1] ?? namespace;
};

const isCollapsibleNamespace = (namespace: string): boolean => {
    const leaf = getShortName(namespace);
    return /^stablehlo\.(reduce|scatter)_\d+$/.test(leaf);
};

const getOwningCollapsedNamespace = (
    namespace: string | undefined,
    collapsedNamespaces: Set<string>,
): string | undefined => {
    if (!namespace) {
        return undefined;
    }

    return Array.from(collapsedNamespaces)
        .sort((a, b) => b.length - a.length)
        .find((collapsedNs) => namespace === collapsedNs || namespace.startsWith(`${collapsedNs}/`));
};

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

    const nodeMap = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

    const initialCollapsedNamespaces = useMemo(
        () =>
            new Set(
                Array.from(new Set(graph.nodes.map((n) => n.namespace).filter(Boolean) as string[])).filter(
                    isCollapsibleNamespace,
                ),
            ),
        [graph.nodes],
    );

    const [collapsedNamespaces, setCollapsedNamespaces] = useState<Set<string>>(initialCollapsedNamespaces);

    useEffect(() => {
        setCollapsedNamespaces(initialCollapsedNamespaces);
    }, [initialCollapsedNamespaces]);

    const { computedNodes, computedEdges } = useMemo(() => {
        const collapsibleNamespaces = Array.from(
            new Set(graph.nodes.map((n) => n.namespace).filter(Boolean) as string[]),
        ).filter(isCollapsibleNamespace);

        const groupNodes: Node<MLNodeData>[] = collapsibleNamespaces.map((namespace) => {
            const isCollapsed = collapsedNamespaces.has(namespace);

            return {
                id: `group:${namespace}`,
                data: {
                    label: `${isCollapsed ? '▸' : '▾'} ${getShortName(namespace)}`,
                    kind: 'group',
                    namespace,
                    collapsed: isCollapsed,
                },
                position: { x: 0, y: 0 },
                style: {
                    border: `1px solid ${isCollapsed ? '#666' : '#888'}`,
                    borderRadius: 12,
                    padding: 10,
                    background: isCollapsed ? '#2f2f2f' : '#3a3a3a',
                    color: '#fff',
                    minWidth: 220,
                    cursor: 'pointer',
                    fontWeight: 600,
                },
            };
        });

        const visibleOpNodes: Node<MLNodeData>[] = graph.nodes
            .filter((n) => {
                if (!n.namespace) {
                    return true;
                }

                const owningCollapsedNs = getOwningCollapsedNamespace(n.namespace, collapsedNamespaces);

                if (!owningCollapsedNs) {
                    return true;
                }

                return false;
            })
            .map((n) => ({
                id: n.id,
                data: {
                    label: n.label,
                    kind: 'op',
                    namespace: n.namespace,
                    collapsed: false,
                },
                position: { x: 0, y: 0 },
                style: {
                    color: '#222',
                    background: '#f5f5f5',
                    border: '1px solid #999',
                    borderRadius: 6,
                    fontSize: 12,
                },
            }));

        // eslint-disable-next-line @typescript-eslint/no-shadow
        const computedNodes: Node<MLNodeData>[] = [...groupNodes, ...visibleOpNodes];

        const getVisibleEndpointId = (nodeId: string): string => {
            const rawNode = nodeMap.get(nodeId);
            const owningCollapsedNs = getOwningCollapsedNamespace(rawNode?.namespace, collapsedNamespaces);
            return owningCollapsedNs ? `group:${owningCollapsedNs}` : nodeId;
        };

        const seen = new Set<string>();
        // eslint-disable-next-line @typescript-eslint/no-shadow
        const computedEdges: Edge[] = [];

        for (const target of graph.nodes) {
            for (const e of target.incomingEdges ?? []) {
                const visibleSource = getVisibleEndpointId(e.sourceNodeId);
                const visibleTarget = getVisibleEndpointId(target.id);

                if (visibleSource === visibleTarget) {
                    // eslint-disable-next-line no-continue
                    continue;
                }

                const key = `${visibleSource}:${e.sourceNodeOutputId}->${visibleTarget}:${e.targetNodeInputId}`;
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

                computedEdges.push({
                    id: key,
                    source: visibleSource,
                    target: visibleTarget,
                    sourceHandle: visibleSource === e.sourceNodeId ? e.sourceNodeOutputId : undefined,
                    targetHandle: visibleTarget === target.id ? e.targetNodeInputId : undefined,
                    label: shapeLabel || `${e.sourceNodeOutputId}→${e.targetNodeInputId}`,
                    markerEnd: { type: MarkerType.ArrowClosed, height: 20, width: 20 },
                });
            }
        }

        return { computedNodes, computedEdges };
    }, [collapsedNamespaces, graph.nodes, nodeMap]);

    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    const doLayout = useCallback(async () => {
        const { nodes: laidOutNodes, edges: laidOutEdges } = await layoutWithElk(nodes, edges);
        setNodes(laidOutNodes);
        setEdges(laidOutEdges);
    }, [nodes, edges, setNodes, setEdges]);

    useEffect(() => {
        let cancelled = false;

        const runLayout = async () => {
            const { nodes: laidOutNodes, edges: laidOutEdges } = await layoutWithElk(computedNodes, computedEdges);
            if (!cancelled) {
                setNodes(laidOutNodes);
                setEdges(laidOutEdges);
            }
        };

        // eslint-disable-next-line no-void
        void runLayout();

        return () => {
            cancelled = true;
        };
    }, [computedNodes, computedEdges, setNodes, setEdges]);

    const handleNodeClick = useCallback((_: React.MouseEvent, node: Node<MLNodeData>) => {
        if (node.data.kind !== 'group' || !node.data.namespace) {
            return;
        }

        setCollapsedNamespaces((prev) => {
            const next = new Set(prev);
            if (next.has(node.data.namespace!)) {
                next.delete(node.data.namespace!);
            } else {
                next.add(node.data.namespace!);
            }
            return next;
        });
    }, []);

    const nodeTypes = useMemo(() => ({}), []);

    return (
        <div style={{ width: '100%', height: '80vh' }}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                minZoom={0.1}
                maxZoom={1.5}
                fitView
                connectionLineType={ConnectionLineType.SmoothStep}
                onNodeClick={handleNodeClick}
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
