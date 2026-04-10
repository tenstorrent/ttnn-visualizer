/* eslint-disable no-void */
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
import type { BuiltGraph, SourceNode, WorkerInteractionIndex, WorkerOutboundMessage } from './mlirGraphTypes';

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
    const [indexReadyGraphId, setIndexReadyGraphId] = useState<string | null>(null);
    const [interactionIndex, setInteractionIndex] = useState<WorkerInteractionIndex | null>(null);
    const viewportAnchorRef = useRef<{
        toNodeId: string;
        fromPosition: { x: number; y: number };
    } | null>(null);
    const hasFitInitiallyRef = useRef(false);
    const workerRef = useRef<Worker | null>(null);
    const nextRequestIdRef = useRef(0);
    const activeRequestIdRef = useRef(0);

    const sourceNodes: SourceNode[] = useMemo(
        () =>
            graph.nodes.map((node) => ({
                id: node.id,
                label: node.label,
                namespace: node.namespace,
                attrs: node.attrs,
                incomingEdges: node.incomingEdges,
                outputsMetadata: node.outputsMetadata,
                config: node.config,
            })),
        [graph.nodes],
    );

    useEffect(() => {
        hasFitInitiallyRef.current = false;
        setExpandedNamespaces(new Set());
        viewportAnchorRef.current = null;
        setInteractionIndex(null);
    }, [graph.id]);

    const applyBuiltGraph = useCallback(
        (built: BuiltGraph) => {
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
        [fitView, getViewport, setEdges, setNodes, setViewport],
    );

    useEffect(() => {
        const worker = new Worker(new URL('./mlirLayoutWorker.ts', import.meta.url), { type: 'module' });
        workerRef.current = worker;
        return () => {
            worker.terminate();
            workerRef.current = null;
        };
    }, []);

    useEffect(() => {
        const worker = workerRef.current;
        if (!worker) {
            return;
        }
        worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
            const message = event.data;
            if (message.type === 'indexed') {
                if (message.graphId === graph.id) {
                    setInteractionIndex(message.interactionIndex);
                    setIndexReadyGraphId(message.graphId);
                }
                return;
            }
            if (message.requestId !== activeRequestIdRef.current) {
                return;
            }
            if (message.type === 'error') {
                // eslint-disable-next-line no-console
                console.error('mlir layout worker:', message.error);
                return;
            }
            if (message.graphId !== graph.id) {
                return;
            }
            applyBuiltGraph(message.graph);
        };
    }, [applyBuiltGraph, graph.id]);

    const runBuild = useCallback(
        (expanded: Set<string>) => {
            const worker = workerRef.current;
            if (!worker || indexReadyGraphId !== graph.id) {
                return;
            }
            const requestId = nextRequestIdRef.current + 1;
            nextRequestIdRef.current = requestId;
            activeRequestIdRef.current = requestId;
            const expandedSorted = Array.from(expanded).sort((a, b) => a.localeCompare(b));
            worker.postMessage({
                type: 'build',
                requestId,
                graphId: graph.id,
                expandedNamespaces: expandedSorted,
                cacheKey: `${graph.id}:${expandedSorted.join('|')}`,
            });
        },
        [graph.id, indexReadyGraphId],
    );

    useEffect(() => {
        runBuild(expandedNamespaces);
    }, [expandedNamespaces, runBuild]);

    useEffect(() => {
        const worker = workerRef.current;
        if (!worker) {
            return;
        }
        setIndexReadyGraphId(null);
        worker.postMessage({
            type: 'set-graph',
            graphId: graph.id,
            nodes: sourceNodes,
        });
    }, [graph.id, sourceNodes]);

    const onSubgraphNodeClick = useCallback(
        (_event: MouseEvent, node: MLNode) => {
            if (node.type === 'group') {
                return;
            }
            const toggleNamespace =
                node.data?.collapsedSubgraphNamespace ??
                interactionIndex?.anchorNamespaceByNodeId[node.id] ??
                interactionIndex?.outerNamespaceByNodeId[node.id];
            if (toggleNamespace) {
                const isExpanded = expandedNamespaces.has(toggleNamespace);
                if (isExpanded) {
                    const anchorNodeId = interactionIndex?.anchorByNamespace[toggleNamespace];
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
            expandedNamespaces,
            interactionIndex,
            nodes,
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
                onClick={() => runBuild(expandedNamespaces)}
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
