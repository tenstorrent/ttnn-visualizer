/* eslint-disable no-continue */
/* eslint-disable no-void */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
    kind?: 'op' | 'group' | 'subgraphBox';
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

const SUBGRAPH_PADDING_X = 36;
const SUBGRAPH_PADDING_TOP = 44;
const SUBGRAPH_PADDING_BOTTOM = 28;

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
            draggable: n.data.kind !== 'subgraphBox',
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

function getBounds(nodes: Node<MLNodeData>[]) {
    const minX = Math.min(...nodes.map((n) => n.position.x));
    const minY = Math.min(...nodes.map((n) => n.position.y));
    const maxX = Math.max(...nodes.map((n) => n.position.x + (n.width ?? 180)));
    const maxY = Math.max(...nodes.map((n) => n.position.y + (n.height ?? 48)));

    return { minX, minY, maxX, maxY };
}

function translateExpandedNamespacesInPlace(
    laidOutNodes: Node<MLNodeData>[],
    expandedNamespaces: string[],
    previousPositions: Map<string, { x: number; y: number }>,
): Node<MLNodeData>[] {
    let nextNodes = [...laidOutNodes];

    for (const namespace of expandedNamespaces) {
        const anchorId = `group:${namespace}`;
        const anchorPosition = previousPositions.get(anchorId);

        if (!anchorPosition) {
            continue;
        }

        const regionNodes = nextNodes.filter(
            (node) => node.data.kind === 'op' && isNodeInsideNamespaceTree(node.data.namespace, namespace),
        );

        if (regionNodes.length === 0) {
            continue;
        }

        const bounds = getBounds(regionNodes);
        const regionCenterX = (bounds.minX + bounds.maxX) / 2;
        const regionTopY = bounds.minY;

        const targetCenterX = anchorPosition.x + 110;
        const targetTopY = anchorPosition.y + 20;

        const dx = targetCenterX - regionCenterX;
        const dy = targetTopY - regionTopY;

        nextNodes = nextNodes.map((node) => {
            if (node.data.kind === 'op' && isNodeInsideNamespaceTree(node.data.namespace, namespace)) {
                return {
                    ...node,
                    position: {
                        x: node.position.x + dx,
                        y: node.position.y + dy,
                    },
                };
            }
            return node;
        });
    }

    return nextNodes;
}

function buildSubgraphBoxNodes(laidOutNodes: Node<MLNodeData>[], expandedNamespaces: string[]): Node<MLNodeData>[] {
    return expandedNamespaces.flatMap((namespace) => {
        const childNodes = laidOutNodes.filter(
            (node) => node.data.kind === 'op' && isNodeInsideNamespaceTree(node.data.namespace, namespace),
        );

        if (childNodes.length === 0) {
            return [];
        }

        const minX = Math.min(...childNodes.map((n) => n.position.x));
        const minY = Math.min(...childNodes.map((n) => n.position.y));
        const maxX = Math.max(...childNodes.map((n) => n.position.x + (n.width ?? 180)));
        const maxY = Math.max(...childNodes.map((n) => n.position.y + (n.height ?? 48)));

        return [
            {
                id: `subgraph:${namespace}`,
                data: {
                    label: `▾ ${getShortName(namespace)} [subgraph]`,
                    kind: 'subgraphBox',
                    namespace,
                    collapsed: false,
                },
                position: {
                    x: minX - SUBGRAPH_PADDING_X,
                    y: minY - SUBGRAPH_PADDING_TOP,
                },
                draggable: false,
                selectable: true,
                style: {
                    width: maxX - minX + SUBGRAPH_PADDING_X * 2,
                    height: maxY - minY + SUBGRAPH_PADDING_TOP + SUBGRAPH_PADDING_BOTTOM,
                    border: '2px dashed #7d7d7d',
                    borderRadius: 16,
                    background: 'rgba(90, 90, 90, 0.14)',
                    color: '#ddd',
                    fontWeight: 600,
                    padding: '10px 12px',
                    zIndex: 0,
                },
            },
        ];
    });
}

const MlGraphInner: React.FC<ViewProps> = ({ data }) => {
    const { fitView } = useReactFlow();
    const graph = data.graphs[0];
    const hasFitInitiallyRef = useRef(false);
    const previousNodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

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

    const collapsibleNamespaces = useMemo(
        () =>
            Array.from(new Set(graph.nodes.map((n) => n.namespace).filter(Boolean) as string[])).filter(
                isCollapsibleNamespace,
            ),
        [graph.nodes],
    );

    const [collapsedNamespaces, setCollapsedNamespaces] = useState<Set<string>>(() => new Set(collapsibleNamespaces));

    const { computedNodes, computedEdges, expandedNamespaces } = useMemo(() => {
        const expandedNamespaceList = collapsibleNamespaces.filter((namespace) => !collapsedNamespaces.has(namespace));

        const groupNodes: Node<MLNodeData>[] = collapsibleNamespaces
            .filter((namespace) => collapsedNamespaces.has(namespace))
            .map((namespace) => ({
                id: `group:${namespace}`,
                data: {
                    label: `▸ ${getShortName(namespace)}`,
                    kind: 'group',
                    namespace,
                    collapsed: true,
                },
                position: { x: 0, y: 0 },
                style: {
                    border: '1px solid #666',
                    borderRadius: 12,
                    padding: 10,
                    background: '#2f2f2f',
                    color: '#fff',
                    minWidth: 220,
                    cursor: 'pointer',
                    fontWeight: 600,
                },
            }));

        const visibleOpNodes: Node<MLNodeData>[] = graph.nodes
            .filter((n) => {
                if (!n.namespace) {
                    return true;
                }

                const owningCollapsedNs = getOwningCollapsedNamespace(n.namespace, collapsedNamespaces);
                if (owningCollapsedNs) {
                    return false;
                }

                const isOuterOpOfExpandedRegion = expandedNamespaceList.some((expandedNs) => {
                    const outerOp = getOuterOpForExpandedNamespace(expandedNs, graph.nodes);
                    return outerOp?.id === n.id;
                });

                if (isOuterOpOfExpandedRegion) {
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

        const nextNodes: Node<MLNodeData>[] = [...groupNodes, ...visibleOpNodes];

        const getVisibleEndpointId = (nodeId: string): string => {
            const rawNode = nodeMap.get(nodeId);
            const owningCollapsedNs = getOwningCollapsedNamespace(rawNode?.namespace, collapsedNamespaces);
            return owningCollapsedNs ? `group:${owningCollapsedNs}` : nodeId;
        };

        const seen = new Set<string>();
        const nextEdges: Edge[] = [];

        for (const target of graph.nodes) {
            for (const e of target.incomingEdges ?? []) {
                const visibleSource = getVisibleEndpointId(e.sourceNodeId);
                const visibleTarget = getVisibleEndpointId(target.id);

                if (visibleSource === visibleTarget) {
                    continue;
                }

                const key = `${visibleSource}:${e.sourceNodeOutputId}->${visibleTarget}:${e.targetNodeInputId}`;
                if (seen.has(key)) {
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

                nextEdges.push({
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

        for (const expandedNs of expandedNamespaceList) {
            const outerOp = getOuterOpForExpandedNamespace(expandedNs, graph.nodes);
            const inputNodes = getInputNodesForExpandedNamespace(expandedNs, graph.nodes);
            const returnNode = getReturnNodeForExpandedNamespace(expandedNs, graph.nodes);

            if (!outerOp) {
                continue;
            }

            const sortedInputs = [...inputNodes].sort((a, b) => a.label.localeCompare(b.label));

            for (const incoming of outerOp.incomingEdges ?? []) {
                const inputIndex = Number(incoming.targetNodeInputId);
                const targetInputNode = sortedInputs[inputIndex];

                if (!targetInputNode) {
                    continue;
                }

                const sourceId = getVisibleEndpointId(incoming.sourceNodeId);
                const targetId = targetInputNode.id;
                const bridgeId = `bridge-in:${sourceId}->${targetId}:${expandedNs}:${incoming.targetNodeInputId}`;

                if (seen.has(bridgeId) || sourceId === targetId) {
                    continue;
                }
                seen.add(bridgeId);

                nextEdges.push({
                    id: bridgeId,
                    source: sourceId,
                    target: targetId,
                    markerEnd: { type: MarkerType.ArrowClosed, height: 20, width: 20 },
                    style: {
                        strokeDasharray: '4 2',
                    },
                });
            }

            if (returnNode) {
                for (const consumer of graph.nodes) {
                    for (const incoming of consumer.incomingEdges ?? []) {
                        if (incoming.sourceNodeId !== outerOp.id) {
                            continue;
                        }

                        const sourceId = returnNode.id;
                        const targetId = getVisibleEndpointId(consumer.id);
                        const bridgeId = `bridge-out:${sourceId}->${targetId}:${expandedNs}:${incoming.targetNodeInputId}`;

                        if (seen.has(bridgeId) || sourceId === targetId) {
                            continue;
                        }
                        seen.add(bridgeId);

                        nextEdges.push({
                            id: bridgeId,
                            source: sourceId,
                            target: targetId,
                            markerEnd: { type: MarkerType.ArrowClosed, height: 20, width: 20 },
                            style: {
                                strokeDasharray: '4 2',
                            },
                        });
                    }
                }
            }
        }

        return {
            computedNodes: nextNodes,
            computedEdges: nextEdges,
            expandedNamespaces: expandedNamespaceList,
        };
    }, [collapsedNamespaces, collapsibleNamespaces, graph.nodes, nodeMap]);

    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    const doLayout = useCallback(async () => {
        const { nodes: laidOutNodes, edges: laidOutEdges } = await layoutWithElk(computedNodes, computedEdges);

        const shiftedNodes = translateExpandedNamespacesInPlace(
            laidOutNodes,
            expandedNamespaces,
            previousNodePositionsRef.current,
        );
        const boxNodes = buildSubgraphBoxNodes(shiftedNodes, expandedNamespaces);

        setNodes([...boxNodes, ...shiftedNodes]);
        setEdges(laidOutEdges);
    }, [computedEdges, computedNodes, expandedNamespaces, setEdges, setNodes]);

    useEffect(() => {
        let cancelled = false;

        const runLayout = async () => {
            const { nodes: laidOutNodes, edges: laidOutEdges } = await layoutWithElk(computedNodes, computedEdges);

            const shiftedNodes = translateExpandedNamespacesInPlace(
                laidOutNodes,
                expandedNamespaces,
                previousNodePositionsRef.current,
            );
            const boxNodes = buildSubgraphBoxNodes(shiftedNodes, expandedNamespaces);

            if (!cancelled) {
                setNodes([...boxNodes, ...shiftedNodes]);
                setEdges(laidOutEdges);

                if (!hasFitInitiallyRef.current) {
                    requestAnimationFrame(() => {
                        void fitView({ padding: 0.2, duration: 200 });
                    });
                    hasFitInitiallyRef.current = true;
                }
            }
        };

        void runLayout();

        return () => {
            cancelled = true;
        };
    }, [computedNodes, computedEdges, expandedNamespaces, fitView, setEdges, setNodes]);

    useEffect(() => {
        const map = new Map<string, { x: number; y: number }>();
        for (const node of nodes) {
            map.set(node.id, { x: node.position.x, y: node.position.y });
        }
        previousNodePositionsRef.current = map;
    }, [nodes]);

    const handleNodeClick = useCallback((_: React.MouseEvent, node: Node<MLNodeData>) => {
        if ((node.data.kind !== 'group' && node.data.kind !== 'subgraphBox') || !node.data.namespace) {
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

            {}
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
