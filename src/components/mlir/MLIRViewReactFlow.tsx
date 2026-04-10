/* eslint-disable no-void */
/* eslint-disable no-continue */
/* eslint-disable react/prop-types */

import React, { type MouseEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'styles/components/MLIRViewReactFlow.scss';
import type { Edge, Node, NodeProps } from '@xyflow/react';
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
const MlirOpNode = memo<NodeProps<MLNode>>(({ id, data }) => (
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
));

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

const getNodeAttrValue = (node: GraphBundle['graphs'][0]['nodes'][number], key: string): string | undefined =>
    node.attrs.find((attr) => attr.key === key)?.value;

const getNamespaceOrdinal = (namespace: string): number => {
    const leaf = getShortName(namespace);
    const match = leaf.match(/_(\d+)$/);
    return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
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

    const {
        subgraphNamespaces,
        namespaceAnchorNodeByNamespace,
        anchorNamespaceByNodeId,
        namespaceInputNodeIdsByNamespace,
        namespaceReturnNodeByNamespace,
        outerNamespaceByNodeId,
    } = useMemo(() => {
        const nodeIndexById = new Map(graph.nodes.map((n, idx) => [n.id, idx]));
        const nodesByNamespace = new Map<string, typeof graph.nodes>();
        const labelsByNamespace = new Map<string, Set<string>>();
        const namespacesWithChildren = new Set<string>();
        for (const n of graph.nodes) {
            if (!n.namespace) {
                continue;
            }
            const arr = nodesByNamespace.get(n.namespace);
            if (arr) {
                arr.push(n);
                labelsByNamespace.get(n.namespace)!.add(n.label);
            } else {
                nodesByNamespace.set(n.namespace, [n]);
                labelsByNamespace.set(n.namespace, new Set([n.label]));
            }
            const segments = n.namespace.split('/');
            for (let i = 1; i < segments.length; i++) {
                namespacesWithChildren.add(segments.slice(0, i).join('/'));
            }
        }

        const collapsible: string[] = [];
        for (const ns of nodesByNamespace.keys()) {
            const expectedLabel = getRegionBaseOpLabel(ns);
            if (!labelsByNamespace.get(ns)?.has(expectedLabel)) {
                continue;
            }
            if (namespacesWithChildren.has(ns)) {
                collapsible.push(ns);
                continue;
            }
            const parentNs = getParentNamespace(ns);
            if (parentNs && labelsByNamespace.get(parentNs)?.has(expectedLabel)) {
                collapsible.push(ns);
            }
        }
        const sorted = [...collapsible].sort((a, b) => {
            const ord = getNamespaceOrdinal(a) - getNamespaceOrdinal(b);
            return ord !== 0 ? ord : a.localeCompare(b);
        });

        const anchorMap = new Map<string, string>();
        const anchorReverseMap = new Map<string, string>();
        for (const ns of sorted) {
            const expectedLabel = getRegionBaseOpLabel(ns);
            const candidates = (nodesByNamespace.get(ns) ?? []).filter((n) => n.label === expectedLabel);
            candidates.sort((a, b) => {
                const aPinned = a.config?.pinToGroupTop ? 1 : 0;
                const bPinned = b.config?.pinToGroupTop ? 1 : 0;
                if (aPinned !== bPinned) {
                    return bPinned - aPinned;
                }
                return (nodeIndexById.get(a.id) ?? 0) - (nodeIndexById.get(b.id) ?? 0);
            });
            if (candidates[0]) {
                anchorMap.set(ns, candidates[0].id);
                anchorReverseMap.set(candidates[0].id, ns);
            }
        }

        const outerMap = new Map<string, string>();
        const usedOuterNodeIds = new Set<string>();
        for (const ns of sorted) {
            const parentNs = getParentNamespace(ns);
            if (!parentNs) {
                continue;
            }
            const expectedLabel = getRegionBaseOpLabel(ns);
            const nsNodes = nodesByNamespace.get(ns) ?? [];
            const preferredLocations = new Set(
                nsNodes
                    .filter((n) => n.label === expectedLabel)
                    .map((n) => getNodeAttrValue(n, 'full_location'))
                    .filter((v): v is string => Boolean(v)),
            );
            const outerCandidates = (nodesByNamespace.get(parentNs) ?? []).filter(
                (n) => n.label === expectedLabel && !usedOuterNodeIds.has(n.id),
            );
            outerCandidates.sort((a, b) => (nodeIndexById.get(a.id) ?? 0) - (nodeIndexById.get(b.id) ?? 0));
            const outer =
                outerCandidates.find((c) => {
                    const loc = getNodeAttrValue(c, 'full_location');
                    return loc ? preferredLocations.has(loc) : false;
                }) ?? outerCandidates[0];
            if (outer) {
                outerMap.set(outer.id, ns);
                usedOuterNodeIds.add(outer.id);
            }
        }

        const sortedSet = new Set(sorted);
        const inputNodesByNs = new Map<string, typeof graph.nodes>();
        const returnCandidatesByNs = new Map<string, typeof graph.nodes>();
        const argPattern = /^%arg\d+$/i;
        const returnPattern = /\.return$|^return$/i;
        for (const n of graph.nodes) {
            if (!n.namespace) {
                continue;
            }
            if (sortedSet.has(n.namespace) && returnPattern.test(n.label)) {
                const arr = returnCandidatesByNs.get(n.namespace);
                if (arr) {
                    arr.push(n);
                } else {
                    returnCandidatesByNs.set(n.namespace, [n]);
                }
            }
            if ((n.incomingEdges ?? []).length === 0) {
                const isArg = argPattern.test(n.label);
                const segments = n.namespace.split('/');
                for (let i = 1; i <= segments.length; i++) {
                    const ancestor = segments.slice(0, i).join('/');
                    if (!sortedSet.has(ancestor)) {
                        continue;
                    }
                    if (isArg || n.namespace.startsWith(`${ancestor}/Inputs`)) {
                        const arr = inputNodesByNs.get(ancestor);
                        if (arr) {
                            arr.push(n);
                        } else {
                            inputNodesByNs.set(ancestor, [n]);
                        }
                    }
                }
            }
        }
        const inputMap = new Map<string, string[]>();
        const returnMap = new Map<string, string>();
        for (const ns of sorted) {
            const inputNodes = inputNodesByNs.get(ns) ?? [];
            inputNodes.sort((a, b) => {
                const aIdx = Number(a.label.match(/^%arg(\d+)$/i)?.[1] ?? Infinity);
                const bIdx = Number(b.label.match(/^%arg(\d+)$/i)?.[1] ?? Infinity);
                return aIdx !== bIdx ? aIdx - bIdx : (nodeIndexById.get(a.id) ?? 0) - (nodeIndexById.get(b.id) ?? 0);
            });
            inputMap.set(
                ns,
                inputNodes.map((n) => n.id),
            );
            const returnCandidates = returnCandidatesByNs.get(ns) ?? [];
            returnCandidates.sort((a, b) => (nodeIndexById.get(b.id) ?? 0) - (nodeIndexById.get(a.id) ?? 0));
            if (returnCandidates[0]) {
                returnMap.set(ns, returnCandidates[0].id);
            }
        }

        return {
            subgraphNamespaces: sorted,
            namespaceAnchorNodeByNamespace: anchorMap,
            anchorNamespaceByNodeId: anchorReverseMap,
            namespaceInputNodeIdsByNamespace: inputMap,
            namespaceReturnNodeByNamespace: returnMap,
            outerNamespaceByNodeId: outerMap,
        };
    }, [graph]);

    const graphIndex: GraphIndex = useMemo(() => {
        const subgraphNsSet = new Set(subgraphNamespaces);
        const getContainingNamespaces = (namespace?: string): string[] => {
            if (!namespace) {
                return [];
            }
            const result: string[] = [];
            const segments = namespace.split('/');
            for (let i = 1; i <= segments.length; i++) {
                const ancestor = segments.slice(0, i).join('/');
                if (subgraphNsSet.has(ancestor)) {
                    result.push(ancestor);
                }
            }
            return result;
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
                onlyRenderVisibleElements
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
