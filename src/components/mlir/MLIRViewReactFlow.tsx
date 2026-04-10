/* eslint-disable no-void */

import React, { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'styles/components/MLIRViewReactFlow.scss';
import {
    Background,
    ConnectionLineType,
    Controls,
    Handle,
    MarkerType,
    MiniMap,
    Position,
    ReactFlow,
    ReactFlowProvider,
    useEdgesState,
    useNodesState,
    useReactFlow,
} from '@xyflow/react';
import type { Edge, Node, NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { Button } from '@blueprintjs/core';
import { GraphBundle } from '../../model/MLIRJsonModel';
import type { BuiltGraph, GraphIndex } from './mlirGraphTypes';
import { buildVisibleGraph } from './mlirGraphBuilder';

type MLNodeData = {
    label: string;
    kind?: 'op' | 'group';
    namespace: string;
    collapsedSubgraphNamespace?: string;
    subgraphToggleState?: 'collapsed' | 'expanded';
};

interface ViewProps {
    data: GraphBundle;
}

type MLNode = Node<MLNodeData>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MlirOpNode: React.FC<NodeProps<MLNode>> = ({ id, data }) => (
    <>
        <Handle
            type='target'
            position={Position.Top}
            isConnectable={false}
        />
        {data.collapsedSubgraphNamespace ? (
            <span
                className='mlir-op-node-collapse-hint'
                title={
                    data.subgraphToggleState === 'expanded'
                        ? 'Subgraph expanded — click to collapse'
                        : 'Subgraph collapsed — click to expand'
                }
            >
                {data.subgraphToggleState === 'expanded' ? '▾' : '▸'}
            </span>
        ) : null}
        <div className='mlir-op-node-label'>{data.label}</div>
        <Handle
            type='source'
            position={Position.Bottom}
            isConnectable={false}
        />
    </>
);

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

const isCollapsibleNamespace = (namespace: string, nodes: GraphBundle['graphs'][0]['nodes']): boolean => {
    const expectedLabel = getRegionBaseOpLabel(namespace);
    const hasMatchingInnerOp = nodes.some((n) => n.namespace === namespace && n.label === expectedLabel);
    if (!hasMatchingInnerOp) {
        return false;
    }
    const hasNestedNamespaceContent = nodes.some((n) => {
        if (!n.namespace) {
            return false;
        }
        return n.namespace !== namespace && n.namespace.startsWith(`${namespace}/`);
    });
    if (hasNestedNamespaceContent) {
        return true;
    }
    const parentNamespace = getParentNamespace(namespace);
    if (!parentNamespace) {
        return false;
    }
    return nodes.some((n) => n.namespace === parentNamespace && n.label === expectedLabel);
};

const getNodeAttrValue = (node: GraphBundle['graphs'][0]['nodes'][number], key: string): string | undefined =>
    node.attrs.find((attr) => attr.key === key)?.value;

const getNamespaceOrdinal = (namespace: string): number => {
    const leaf = getShortName(namespace);
    const match = leaf.match(/_(\d+)$/);
    return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
};

const isNodeInsideNamespaceTree = (nodeNamespace: string | undefined, namespace: string): boolean => {
    if (!nodeNamespace) {
        return false;
    }
    return nodeNamespace === namespace || nodeNamespace.startsWith(`${namespace}/`);
};

function builtGraphToReactFlow(built: BuiltGraph): { nodes: MLNode[]; edges: Edge[] } {
    const nodes: MLNode[] = built.nodes.map((n) => ({
        ...n,
        type: n.type === 'group' ? 'group' : 'mlirOp',
        data: n.data as MLNodeData,
    }));
    const edges: Edge[] = built.edges.map((e) => ({
        ...e,
        markerEnd: e.markerEnd ? { ...e.markerEnd, type: MarkerType.ArrowClosed } : undefined,
    }));
    return { nodes, edges };
}

const MlGraphInner: React.FC<ViewProps> = ({ data }) => {
    const { fitView, getViewport, setViewport } = useReactFlow();
    const graph = data.graphs[0];
    const [nodes, setNodes, onNodesChange] = useNodesState<MLNode>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [expandedNamespaces, setExpandedNamespaces] = useState<Set<string>>(() => new Set());
    const viewportAnchorRef = useRef<{
        toNodeId: string;
        fromPosition: { x: number; y: number };
    } | null>(null);
    const hasFitInitiallyRef = useRef(false);
    const buildSeqRef = useRef(0);

    const collapsibleNamespaces = useMemo(
        () =>
            Array.from(new Set(graph.nodes.map((n) => n.namespace).filter(Boolean) as string[])).filter((namespace) =>
                isCollapsibleNamespace(namespace, graph.nodes),
            ),
        [graph.nodes],
    );

    const outerNamespaceByNodeId = useMemo(() => {
        const map = new Map<string, string>();
        const usedOuterNodeIds = new Set<string>();
        const nodeIndexById = new Map(graph.nodes.map((n, idx) => [n.id, idx]));
        const orderedNamespaces = [...collapsibleNamespaces].sort(
            (a, b) => getNamespaceOrdinal(a) - getNamespaceOrdinal(b),
        );
        for (const namespace of orderedNamespaces) {
            const parentNamespace = getParentNamespace(namespace);
            if (parentNamespace) {
                const expectedLabel = getRegionBaseOpLabel(namespace);
                const namespaceNodes = graph.nodes.filter((n) => n.namespace === namespace);
                const preferredLocations = new Set(
                    namespaceNodes
                        .filter((n) => n.label === expectedLabel)
                        .map((n) => getNodeAttrValue(n, 'full_location'))
                        .filter((v): v is string => Boolean(v)),
                );
                const outerCandidates = graph.nodes.filter(
                    (n) => n.namespace === parentNamespace && n.label === expectedLabel && !usedOuterNodeIds.has(n.id),
                );
                outerCandidates.sort((a, b) => (nodeIndexById.get(a.id) ?? 0) - (nodeIndexById.get(b.id) ?? 0));
                const outer =
                    outerCandidates.find((c) => {
                        const loc = getNodeAttrValue(c, 'full_location');
                        return loc ? preferredLocations.has(loc) : false;
                    }) ?? outerCandidates[0];
                if (outer) {
                    map.set(outer.id, namespace);
                    usedOuterNodeIds.add(outer.id);
                }
            }
        }
        return map;
    }, [collapsibleNamespaces, graph.nodes]);

    const subgraphNamespaces = useMemo(() => {
        return [...collapsibleNamespaces].sort((a, b) => {
            const ord = getNamespaceOrdinal(a) - getNamespaceOrdinal(b);
            return ord !== 0 ? ord : a.localeCompare(b);
        });
    }, [collapsibleNamespaces]);

    const namespaceAnchorNodeByNamespace = useMemo(() => {
        const map = new Map<string, string>();
        const nodeIndexById = new Map(graph.nodes.map((n, idx) => [n.id, idx]));
        for (const namespace of subgraphNamespaces) {
            const expectedLabel = getRegionBaseOpLabel(namespace);
            const candidates = graph.nodes.filter((n) => n.namespace === namespace && n.label === expectedLabel);
            candidates.sort((a, b) => {
                const aPinned = a.config?.pinToGroupTop ? 1 : 0;
                const bPinned = b.config?.pinToGroupTop ? 1 : 0;
                if (aPinned !== bPinned) {
                    return bPinned - aPinned;
                }
                return (nodeIndexById.get(a.id) ?? 0) - (nodeIndexById.get(b.id) ?? 0);
            });
            if (candidates[0]) {
                map.set(namespace, candidates[0].id);
            }
        }
        return map;
    }, [graph.nodes, subgraphNamespaces]);

    const anchorNamespaceByNodeId = useMemo(() => {
        const map = new Map<string, string>();
        namespaceAnchorNodeByNamespace.forEach((nodeId, namespace) => {
            map.set(nodeId, namespace);
        });
        return map;
    }, [namespaceAnchorNodeByNamespace]);

    const namespaceInputNodeIdsByNamespace = useMemo(() => {
        const map = new Map<string, string[]>();
        const nodeIndexById = new Map(graph.nodes.map((n, idx) => [n.id, idx]));
        for (const namespace of subgraphNamespaces) {
            const inputNodes = graph.nodes.filter((n) => {
                if (!isNodeInsideNamespaceTree(n.namespace, namespace)) {
                    return false;
                }
                if ((n.incomingEdges ?? []).length > 0) {
                    return false;
                }
                if (n.namespace?.startsWith(`${namespace}/Inputs`)) {
                    return true;
                }
                return /^%arg\d+$/i.test(n.label);
            });
            inputNodes.sort((a, b) => {
                const aIdx = Number(a.label.match(/^%arg(\d+)$/i)?.[1] ?? Infinity);
                const bIdx = Number(b.label.match(/^%arg(\d+)$/i)?.[1] ?? Infinity);
                return aIdx !== bIdx ? aIdx - bIdx : (nodeIndexById.get(a.id) ?? 0) - (nodeIndexById.get(b.id) ?? 0);
            });
            map.set(
                namespace,
                inputNodes.map((n) => n.id),
            );
        }
        return map;
    }, [graph.nodes, subgraphNamespaces]);

    const namespaceReturnNodeByNamespace = useMemo(() => {
        const map = new Map<string, string>();
        const nodeIndexById = new Map(graph.nodes.map((n, idx) => [n.id, idx]));
        for (const namespace of subgraphNamespaces) {
            const returnCandidates = graph.nodes.filter(
                (n) => n.namespace === namespace && /\.return$|^return$/i.test(n.label),
            );
            returnCandidates.sort((a, b) => (nodeIndexById.get(b.id) ?? 0) - (nodeIndexById.get(a.id) ?? 0));
            if (returnCandidates[0]) {
                map.set(namespace, returnCandidates[0].id);
            }
        }
        return map;
    }, [graph.nodes, subgraphNamespaces]);

    const graphIndex: GraphIndex = useMemo(() => {
        const getContainingNamespaces = (namespace?: string): string[] => {
            if (!namespace) {
                return [];
            }
            return [...subgraphNamespaces]
                .filter((candidate) => isNodeInsideNamespaceTree(namespace, candidate))
                .sort((a, b) => a.length - b.length);
        };
        const containingNamespacesByNodeId: Record<string, string[]> = {};
        for (const n of graph.nodes) {
            containingNamespacesByNodeId[n.id] = getContainingNamespaces(n.namespace);
        }
        const anchorByNamespace: Record<string, string> = {};
        namespaceAnchorNodeByNamespace.forEach((nodeId, ns) => {
            anchorByNamespace[ns] = nodeId;
        });
        const anchorNsByNode: Record<string, string> = {};
        anchorNamespaceByNodeId.forEach((ns, nodeId) => {
            anchorNsByNode[nodeId] = ns;
        });
        const namespaceInputByNamespace: Record<string, string[]> = {};
        namespaceInputNodeIdsByNamespace.forEach((ids, ns) => {
            namespaceInputByNamespace[ns] = ids;
        });
        const returnByNamespace: Record<string, string> = {};
        namespaceReturnNodeByNamespace.forEach((nodeId, ns) => {
            returnByNamespace[ns] = nodeId;
        });
        const outerByNode: Record<string, string> = {};
        outerNamespaceByNodeId.forEach((ns, nodeId) => {
            outerByNode[nodeId] = ns;
        });

        return {
            graphId: graph.id,
            nodes: graph.nodes.map((n) => ({
                id: n.id,
                label: n.label,
                namespace: n.namespace,
                incomingEdges: n.incomingEdges,
                outputsMetadata: n.outputsMetadata,
                config: n.config,
            })),
            subgraphNamespaces: [...subgraphNamespaces],
            anchorByNamespace,
            anchorNamespaceByNodeId: anchorNsByNode,
            namespaceInputByNamespace,
            namespaceReturnNodeByNamespace: returnByNamespace,
            containingNamespacesByNodeId,
            outerNamespaceByNodeId: outerByNode,
        };
    }, [
        graph.id,
        graph.nodes,
        subgraphNamespaces,
        namespaceAnchorNodeByNamespace,
        anchorNamespaceByNodeId,
        namespaceInputNodeIdsByNamespace,
        namespaceReturnNodeByNamespace,
        outerNamespaceByNodeId,
    ]);

    useEffect(() => {
        hasFitInitiallyRef.current = false;
        setExpandedNamespaces(new Set());
        viewportAnchorRef.current = null;
    }, [graph.id]);

    const runBuild = useCallback(
        async (expanded: Set<string>) => {
            buildSeqRef.current += 1;
            const seq = buildSeqRef.current;
            const expandedSorted = Array.from(expanded).sort((a, b) => a.localeCompare(b));
            const built = await buildVisibleGraph(graphIndex, expandedSorted);
            if (seq !== buildSeqRef.current) {
                return;
            }
            const rf = builtGraphToReactFlow(built);
            setNodes(rf.nodes);
            setEdges(rf.edges);

            const anchor = viewportAnchorRef.current;
            if (anchor) {
                const toNode = rf.nodes.find((n) => n.id === anchor.toNodeId);
                if (toNode) {
                    const vp = getViewport();
                    const dx = toNode.position.x - anchor.fromPosition.x;
                    const dy = toNode.position.y - anchor.fromPosition.y;
                    void setViewport(
                        { x: vp.x - dx * vp.zoom, y: vp.y - dy * vp.zoom, zoom: vp.zoom },
                        { duration: 0 },
                    );
                }
                viewportAnchorRef.current = null;
            }

            if (!hasFitInitiallyRef.current) {
                requestAnimationFrame(() => {
                    void fitView({ padding: 0.2, duration: 200 });
                });
                hasFitInitiallyRef.current = true;
            }
        },
        [fitView, getViewport, graphIndex, setEdges, setNodes, setViewport],
    );

    useEffect(() => {
        void runBuild(expandedNamespaces);
    }, [expandedNamespaces, runBuild]);

    const onSubgraphNodeClick = useCallback(
        (_event: MouseEvent, node: MLNode) => {
            if (node.type === 'group') {
                return;
            }
            const toggleNamespace =
                node.data?.collapsedSubgraphNamespace ??
                anchorNamespaceByNodeId.get(node.id) ??
                outerNamespaceByNodeId.get(node.id);
            if (toggleNamespace) {
                const isExpanded = expandedNamespaces.has(toggleNamespace);
                if (isExpanded) {
                    const anchorNodeId = namespaceAnchorNodeByNamespace.get(toggleNamespace);
                    let fromPosition = { x: node.position.x, y: node.position.y };
                    if (node.parentId) {
                        const parentNode = nodes.find((n) => n.id === node.parentId);
                        if (parentNode) {
                            fromPosition = { x: parentNode.position.x, y: parentNode.position.y };
                        }
                    }
                    if (anchorNodeId) {
                        viewportAnchorRef.current = { toNodeId: anchorNodeId, fromPosition };
                    }
                    setExpandedNamespaces((prev) => {
                        const next = new Set(prev);
                        next.delete(toggleNamespace);
                        return next;
                    });
                } else {
                    viewportAnchorRef.current = {
                        toNodeId: `group:${toggleNamespace}`,
                        fromPosition: { x: node.position.x, y: node.position.y },
                    };
                    setExpandedNamespaces((prev) => {
                        const next = new Set(prev);
                        next.add(toggleNamespace);
                        return next;
                    });
                }
            }
        },
        [
            //
            anchorNamespaceByNodeId,
            expandedNamespaces,
            namespaceAnchorNodeByNamespace,
            nodes,
            outerNamespaceByNodeId,
        ],
    );

    const nodeTypes = useMemo(() => ({ mlirOp: MlirOpNode }) as const, []);

    return (
        <div style={{ width: '100%', height: 'calc(100vh - 92px - 30px - 56px - 40px)' }}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodeClick={onSubgraphNodeClick}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                minZoom={0.003}
                maxZoom={1.5}
                fitView
                connectionLineType={ConnectionLineType.SmoothStep}
            >
                <MiniMap />
                <Controls />
                <Background />
            </ReactFlow>

            <Button
                onClick={() => void runBuild(expandedNamespaces)}
                style={{ position: 'absolute', top: 80, left: 12, zIndex: 10, padding: '8px 10px' }}
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
