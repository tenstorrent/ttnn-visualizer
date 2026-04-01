/* eslint-disable no-continue */
/* eslint-disable no-void */

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
    ReactFlowProvider,
    useEdgesState,
    useNodesState,
    useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';

import ELK, { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk.bundled';
import { Button } from '@blueprintjs/core';
import { GraphBundle } from '../../model/MLIRJsonModel';

type MLNodeData = {
    label: string;
    kind?: 'op' | 'group';
    namespace: string;
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

const COLLAPSED_GROUP_WIDTH = 220;
const COLLAPSED_GROUP_HEIGHT = 52;
const EXPANDED_GROUP_MIN_WIDTH = 260;
const EXPANDED_GROUP_MIN_HEIGHT = 120;
const CHILD_PADDING_X = 24;
const CHILD_PADDING_TOP = 36;
const CHILD_PADDING_BOTTOM = 20;

function toElkGraph(nodes: Node<MLNodeData>[], edges: Edge[]): ElkNode {
    return {
        id: 'root',
        layoutOptions: elkOptions,
        children: nodes.map((n) => ({
            id: n.id,
            width: n.width ?? Number((n.style as { width?: number })?.width) ?? 180,
            height: n.height ?? Number((n.style as { height?: number })?.height) ?? 48,
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
    if (nodes.length === 0) {
        return { nodes, edges };
    }

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
        };
    });

    return { nodes: nextNodes, edges };
}

const getNamespaceSegments = (namespace?: string): string[] => (namespace ? namespace.split('/').filter(Boolean) : []);

const getShortName = (namespace: string): string => {
    const parts = getNamespaceSegments(namespace);
    return parts[parts.length - 1] ?? namespace;
};

const getParentNamespace = (namespace: string): string | undefined => {
    const parts = getNamespaceSegments(namespace);
    if (parts.length <= 1) {
        return undefined;
    }
    return parts.slice(0, -1).join('/');
};

const getRegionBaseOpLabel = (namespace: string): string => getShortName(namespace).replace(/_\d+$/, '');

const isCollapsibleNamespace = (namespace: string): boolean => {
    const leaf = getShortName(namespace);
    return /^stablehlo\.(reduce|scatter)_\d+$/.test(leaf);
};

const isNodeInsideNamespaceTree = (nodeNamespace: string | undefined, namespace: string): boolean => {
    if (!nodeNamespace) {
        return false;
    }
    return nodeNamespace === namespace || nodeNamespace.startsWith(`${namespace}/`);
};

const getOuterOpForExpandedNamespace = (
    namespace: string,
    nodes: GraphBundle['graphs'][0]['nodes'],
): GraphBundle['graphs'][0]['nodes'][number] | undefined => {
    const parentNamespace = getParentNamespace(namespace);
    const expectedLabel = getRegionBaseOpLabel(namespace);

    return nodes.find((n) => n.namespace === parentNamespace && n.label === expectedLabel);
};

const getInputNodesForExpandedNamespace = (
    namespace: string,
    nodes: GraphBundle['graphs'][0]['nodes'],
): GraphBundle['graphs'][0]['nodes'][number][] => nodes.filter((n) => n.namespace === `${namespace}/Inputs`);

const getReturnNodeForExpandedNamespace = (
    namespace: string,
    nodes: GraphBundle['graphs'][0]['nodes'],
): GraphBundle['graphs'][0]['nodes'][number] | undefined =>
    nodes.find((n) => n.namespace === namespace && n.label === 'stablehlo.return');

function getTensorInfoFromAttrs(attrs: { key: string; value: string }[]) {
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
}

function getBounds(nodes: Node<MLNodeData>[]) {
    const minX = Math.min(...nodes.map((n) => n.position.x));
    const minY = Math.min(...nodes.map((n) => n.position.y));
    const maxX = Math.max(
        ...nodes.map((n) => n.position.x + (n.width ?? Number((n.style as { width?: number })?.width) ?? 180)),
    );
    const maxY = Math.max(
        ...nodes.map((n) => n.position.y + (n.height ?? Number((n.style as { height?: number })?.height) ?? 48)),
    );

    return { minX, minY, maxX, maxY };
}

const MlGraphInner: React.FC<ViewProps> = ({ data }) => {
    const { fitView } = useReactFlow();
    const graph = data.graphs[0];
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [hasFitInitially, setHasFitInitially] = useState(false);

    const nodeMap = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

    const collapsibleNamespaces = useMemo(
        () =>
            Array.from(new Set(graph.nodes.map((n) => n.namespace).filter(Boolean) as string[])).filter(
                isCollapsibleNamespace,
            ),
        [graph.nodes],
    );

    const outerOpByNamespace = useMemo(() => {
        const map = new Map<string, GraphBundle['graphs'][0]['nodes'][number]>();
        for (const namespace of collapsibleNamespaces) {
            const outer = getOuterOpForExpandedNamespace(namespace, graph.nodes);
            if (outer) {
                map.set(namespace, outer);
            }
        }
        return map;
    }, [collapsibleNamespaces, graph.nodes]);

    const outerOpNamespaceById = useMemo(() => {
        const map = new Map<string, string>();
        for (const [namespace, outer] of outerOpByNamespace.entries()) {
            map.set(outer.id, namespace);
        }
        return map;
    }, [outerOpByNamespace]);

    const [collapsedNamespaces, setCollapsedNamespaces] = useState<Set<string>>(() => new Set(collapsibleNamespaces));

    useEffect(() => {
        setCollapsedNamespaces(new Set(collapsibleNamespaces));
        setHasFitInitially(false);
    }, [graph.id, collapsibleNamespaces]);

    const buildVisibleGraph = useCallback(async () => {
        const expandedNamespaces = collapsibleNamespaces.filter((namespace) => !collapsedNamespaces.has(namespace));

        const getContainingNamespace = (namespace?: string): string | undefined => {
            if (!namespace) {
                return undefined;
            }

            return [...collapsibleNamespaces]
                .sort((a, b) => b.length - a.length)
                .find((candidate) => isNodeInsideNamespaceTree(namespace, candidate));
        };

        const topLevelPlaceholderNodes: Node<MLNodeData>[] = collapsibleNamespaces.map((namespace) => {
            const isCollapsed = collapsedNamespaces.has(namespace);
            const isExpanded = !isCollapsed;

            return {
                id: `group:${namespace}`,
                type: isExpanded ? 'group' : undefined,
                data: {
                    label: `${isCollapsed ? '▸' : '▾'} ${getShortName(namespace)}`,
                    kind: 'group',
                    namespace,
                    collapsed: isCollapsed,
                },
                position: { x: 0, y: 0 },
                selectable: true,
                draggable: true,
                style: isExpanded
                    ? {
                          width: EXPANDED_GROUP_MIN_WIDTH,
                          height: EXPANDED_GROUP_MIN_HEIGHT,
                          border: '2px dashed #7d7d7d',
                          borderRadius: 16,
                          background: 'rgba(90, 90, 90, 0.14)',
                          color: '#ddd',
                          padding: '10px 12px',
                      }
                    : {
                          width: COLLAPSED_GROUP_WIDTH,
                          height: COLLAPSED_GROUP_HEIGHT,
                          border: '1px solid #666',
                          borderRadius: 12,
                          background: '#2f2f2f',
                          color: '#fff',
                          padding: '10px 12px',
                          fontWeight: 600,
                      },
            };
        });

        const topLevelVisibleOpNodes: Node<MLNodeData>[] = graph.nodes
            .filter((n) => {
                if (!n.namespace) {
                    return true;
                }

                if (outerOpNamespaceById.has(n.id)) {
                    return false;
                }

                const containingNamespace = getContainingNamespace(n.namespace);
                if (containingNamespace) {
                    return false;
                }

                return true;
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

        const topLevelNodesForLayout: Node<MLNodeData>[] = [...topLevelPlaceholderNodes, ...topLevelVisibleOpNodes];

        const mapToTopLevelEndpointId = (nodeId: string): string => {
            const outerNamespace = outerOpNamespaceById.get(nodeId);
            if (outerNamespace) {
                return `group:${outerNamespace}`;
            }

            const rawNode = nodeMap.get(nodeId);
            const containingNamespace = getContainingNamespace(rawNode?.namespace);

            if (containingNamespace) {
                return `group:${containingNamespace}`;
            }

            return nodeId;
        };

        const topLevelLayoutEdgesSeen = new Set<string>();
        const topLevelLayoutEdges: Edge[] = [];

        for (const target of graph.nodes) {
            for (const incoming of target.incomingEdges ?? []) {
                const sourceId = mapToTopLevelEndpointId(incoming.sourceNodeId);
                const targetId = mapToTopLevelEndpointId(target.id);

                if (sourceId === targetId) {
                    continue;
                }

                const edgeId = `layout:${sourceId}->${targetId}`;
                if (topLevelLayoutEdgesSeen.has(edgeId)) {
                    continue;
                }
                topLevelLayoutEdgesSeen.add(edgeId);

                topLevelLayoutEdges.push({
                    id: edgeId,
                    source: sourceId,
                    target: targetId,
                });
            }
        }

        const { nodes: laidOutTopLevelNodes } = await layoutWithElk(topLevelNodesForLayout, topLevelLayoutEdges);
        const topLevelNodeById = new Map<string, Node<MLNodeData>>(laidOutTopLevelNodes.map((n) => [n.id, n]));

        const finalNodes: Node<MLNodeData>[] = [];
        const finalEdges: Edge[] = [];
        const finalEdgesSeen = new Set<string>();
        const visibleTopLevelIds = new Set<string>();

        const addEdgeSafe = (edge: Edge) => {
            if (edge.source === edge.target) {
                return;
            }
            if (finalEdgesSeen.has(edge.id)) {
                return;
            }
            finalEdgesSeen.add(edge.id);
            finalEdges.push(edge);
        };

        for (const node of topLevelVisibleOpNodes) {
            const laidOut = topLevelNodeById.get(node.id);
            finalNodes.push({
                ...node,
                position: laidOut?.position ?? node.position,
            });
            visibleTopLevelIds.add(node.id);
        }

        for (const namespace of collapsibleNamespaces) {
            const groupId = `group:${namespace}`;
            const laidOutGroup = topLevelNodeById.get(groupId);
            const isCollapsed = collapsedNamespaces.has(namespace);

            if (isCollapsed) {
                finalNodes.push({
                    id: groupId,
                    data: {
                        label: `▸ ${getShortName(namespace)}`,
                        kind: 'group',
                        namespace,
                        collapsed: true,
                    },
                    position: laidOutGroup?.position ?? { x: 0, y: 0 },
                    style: {
                        width: COLLAPSED_GROUP_WIDTH,
                        height: COLLAPSED_GROUP_HEIGHT,
                        border: '1px solid #666',
                        borderRadius: 12,
                        background: '#2f2f2f',
                        color: '#fff',
                        padding: '10px 12px',
                        fontWeight: 600,
                    },
                });
                visibleTopLevelIds.add(groupId);
                continue;
            }

            const childRawNodes = graph.nodes.filter((n) => isNodeInsideNamespaceTree(n.namespace, namespace));

            const childNodesForLayout: Node<MLNodeData>[] = childRawNodes.map((n) => ({
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

            const internalEdgesSeen = new Set<string>();
            const internalEdges: Edge[] = [];

            for (const target of childRawNodes) {
                for (const incoming of target.incomingEdges ?? []) {
                    const sourceRawNode = nodeMap.get(incoming.sourceNodeId);
                    if (!isNodeInsideNamespaceTree(sourceRawNode?.namespace, namespace)) {
                        continue;
                    }

                    const edgeId = `internal:${incoming.sourceNodeId}->${target.id}:${incoming.targetNodeInputId}`;
                    if (internalEdgesSeen.has(edgeId)) {
                        continue;
                    }
                    internalEdgesSeen.add(edgeId);

                    const sourceOutputMeta = sourceRawNode?.outputsMetadata?.find(
                        (m) => m.id === incoming.sourceNodeOutputId,
                    );
                    const edgeLabel = sourceOutputMeta
                        ? getTensorInfoFromAttrs(sourceOutputMeta.attrs).label
                        : undefined;

                    internalEdges.push({
                        id: edgeId,
                        source: incoming.sourceNodeId,
                        target: target.id,
                        sourceHandle: incoming.sourceNodeOutputId,
                        targetHandle: incoming.targetNodeInputId,
                        label: edgeLabel || `${incoming.sourceNodeOutputId}→${incoming.targetNodeInputId}`,
                        markerEnd: { type: MarkerType.ArrowClosed, height: 20, width: 20 },
                    });
                }
            }

            const { nodes: laidOutChildNodes, edges: laidOutChildEdges } = await layoutWithElk(
                childNodesForLayout,
                internalEdges,
            );
            const bounds = laidOutChildNodes.length > 0 ? getBounds(laidOutChildNodes) : undefined;

            const groupWidth = bounds
                ? Math.max(EXPANDED_GROUP_MIN_WIDTH, bounds.maxX - bounds.minX + CHILD_PADDING_X * 2)
                : EXPANDED_GROUP_MIN_WIDTH;
            const groupHeight = bounds
                ? Math.max(
                      EXPANDED_GROUP_MIN_HEIGHT,
                      bounds.maxY - bounds.minY + CHILD_PADDING_TOP + CHILD_PADDING_BOTTOM,
                  )
                : EXPANDED_GROUP_MIN_HEIGHT;

            finalNodes.push({
                id: groupId,
                type: 'group',
                data: {
                    label: `▾ ${getShortName(namespace)}`,
                    kind: 'group',
                    namespace,
                    collapsed: false,
                },
                position: laidOutGroup?.position ?? { x: 0, y: 0 },
                style: {
                    width: groupWidth,
                    height: groupHeight,
                    border: '2px dashed #7d7d7d',
                    borderRadius: 16,
                    background: 'rgba(90, 90, 90, 0.14)',
                    color: '#ddd',
                    padding: '10px 12px',
                },
            });
            visibleTopLevelIds.add(groupId);

            for (const childNode of laidOutChildNodes) {
                finalNodes.push({
                    ...childNode,
                    parentId: groupId,
                    extent: 'parent',
                    draggable: false,
                    position: bounds
                        ? {
                              x: childNode.position.x - bounds.minX + CHILD_PADDING_X,
                              y: childNode.position.y - bounds.minY + CHILD_PADDING_TOP,
                          }
                        : { x: CHILD_PADDING_X, y: CHILD_PADDING_TOP },
                });
            }

            for (const edge of laidOutChildEdges) {
                addEdgeSafe(edge);
            }

            const outerOp = outerOpByNamespace.get(namespace);
            const inputNodes = getInputNodesForExpandedNamespace(namespace, graph.nodes);
            const returnNode = getReturnNodeForExpandedNamespace(namespace, graph.nodes);

            if (outerOp) {
                const sortedInputs = [...inputNodes].sort((a, b) => a.label.localeCompare(b.label));

                for (const incoming of outerOp.incomingEdges ?? []) {
                    const targetInputNode = sortedInputs[Number(incoming.targetNodeInputId)];
                    if (!targetInputNode) {
                        continue;
                    }

                    const sourceId = mapToTopLevelEndpointId(incoming.sourceNodeId);
                    addEdgeSafe({
                        id: `bridge-in:${sourceId}->${targetInputNode.id}:${namespace}:${incoming.targetNodeInputId}`,
                        source: sourceId,
                        target: targetInputNode.id,
                        markerEnd: { type: MarkerType.ArrowClosed, height: 20, width: 20 },
                        style: { strokeDasharray: '4 2' },
                    });
                }

                if (returnNode) {
                    for (const consumer of graph.nodes) {
                        for (const incoming of consumer.incomingEdges ?? []) {
                            if (incoming.sourceNodeId !== outerOp.id) {
                                continue;
                            }

                            const targetId = mapToTopLevelEndpointId(consumer.id);
                            addEdgeSafe({
                                id: `bridge-out:${returnNode.id}->${targetId}:${namespace}:${incoming.targetNodeInputId}`,
                                source: returnNode.id,
                                target: targetId,
                                markerEnd: { type: MarkerType.ArrowClosed, height: 20, width: 20 },
                                style: { strokeDasharray: '4 2' },
                            });
                        }
                    }
                }
            }
        }

        const expandedGroupIds = new Set(expandedNamespaces.map((namespace) => `group:${namespace}`));

        for (const target of graph.nodes) {
            for (const incoming of target.incomingEdges ?? []) {
                const sourceId = mapToTopLevelEndpointId(incoming.sourceNodeId);
                const targetId = mapToTopLevelEndpointId(target.id);

                if (sourceId === targetId) {
                    continue;
                }

                if (expandedGroupIds.has(sourceId) || expandedGroupIds.has(targetId)) {
                    continue;
                }

                if (!visibleTopLevelIds.has(sourceId) || !visibleTopLevelIds.has(targetId)) {
                    continue;
                }

                const sourceNode = nodeMap.get(incoming.sourceNodeId);
                const outputMeta = sourceNode?.outputsMetadata?.find((m) => m.id === incoming.sourceNodeOutputId);
                const edgeLabel = outputMeta ? getTensorInfoFromAttrs(outputMeta.attrs).label : undefined;

                addEdgeSafe({
                    id: `top:${sourceId}->${targetId}:${incoming.targetNodeInputId}`,
                    source: sourceId,
                    target: targetId,
                    label: edgeLabel || `${incoming.sourceNodeOutputId}→${incoming.targetNodeInputId}`,
                    markerEnd: { type: MarkerType.ArrowClosed, height: 20, width: 20 },
                });
            }
        }

        return { nodes: finalNodes, edges: finalEdges };
    }, [collapsedNamespaces, collapsibleNamespaces, graph.nodes, nodeMap, outerOpByNamespace, outerOpNamespaceById]);

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            const visibleGraph = await buildVisibleGraph();

            if (!cancelled) {
                setNodes(visibleGraph.nodes);
                setEdges(visibleGraph.edges);

                if (!hasFitInitially) {
                    requestAnimationFrame(() => {
                        void fitView({ padding: 0.2, duration: 200 });
                    });
                    setHasFitInitially(true);
                }
            }
        };

        void run();

        return () => {
            cancelled = true;
        };
    }, [buildVisibleGraph, fitView, hasFitInitially, setEdges, setNodes]);

    const doLayout = useCallback(async () => {
        const visibleGraph = await buildVisibleGraph();
        setNodes(visibleGraph.nodes);
        setEdges(visibleGraph.edges);
    }, [buildVisibleGraph, setEdges, setNodes]);

    const handleNodeClick = useCallback((_: React.MouseEvent, node: Node<MLNodeData>) => {
        if (node.data.kind !== 'group' || !node.data.namespace) {
            return;
        }

        setCollapsedNamespaces((prev) => {
            const next = new Set(prev);
            if (next.has(node.data.namespace)) {
                next.delete(node.data.namespace);
            } else {
                next.add(node.data.namespace);
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

            <Button
                onClick={() => void doLayout()}
                style={{
                    position: 'absolute',
                    top: 80,
                    left: 12,
                    zIndex: 10,
                    padding: '8px 10px',
                }}
            >
                Re-layout (ELK)
            </Button>
        </div>
    );
};

const MlGraphWithProvider: React.FC<ViewProps> = (props) => (
    <ReactFlowProvider>
        {/* eslint-disable-next-line react/jsx-props-no-spreading */}
        <MlGraphInner {...props} />
    </ReactFlowProvider>
);

export default MlGraphWithProvider;
