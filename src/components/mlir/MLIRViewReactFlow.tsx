/* eslint-disable no-void */
/* eslint-disable react/prop-types */
/* eslint-disable no-continue */

import React, {
    type MouseEvent,
    createContext,
    memo,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
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
import { GRAPH_COLORS } from '../../definitions/GraphColors';

type MLNodeData = {
    label: string;
    kind?: 'op' | 'group';
    namespace: string;
    collapsedSubgraphNamespace?: string;
    subgraphToggleState?: 'collapsed' | 'expanded';
    displayName?: string;
    nodeCount?: number;
    groupKind?: 'section' | 'plain';
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

// Group nodes communicate with the parent component via this context. We can't
// re-enable React Flow's `draggable: true` (it would re-add the `nopan` class
// on the wrapper and break canvas panning inside the group — see worker
// comment), so the header implements drag-to-move manually and uses these
// callbacks to update the parent's node state and to dispatch the collapse.
type MlirGroupContextValue = {
    toggleNamespace: (namespace: string) => void;
    moveGroup: (groupId: string, dx: number, dy: number) => void;
    getZoom: () => number;
};

const MlirGroupContext = createContext<MlirGroupContextValue | null>(null);

const DRAG_THRESHOLD_PX = 4;

const MlirGroupNode = memo<NodeProps<MLNode>>(({ id, data }) => {
    const ctx = useContext(MlirGroupContext);
    const isSection = data.groupKind === 'section';
    const countText = typeof data.nodeCount === 'number' && data.nodeCount > 0 ? ` · ${data.nodeCount} nodes` : '';

    // `dragRef` survives the gesture: started on mousedown, mutated through
    // mousemove (incremental dx/dy applied each frame so React Flow's children
    // — which use `parentId` + `extent: 'parent'` — follow), and read by the
    // immediately-following click handler to suppress the collapse toggle if
    // the gesture moved past the threshold.
    const dragRef = useRef<{
        startX: number;
        startY: number;
        lastX: number;
        lastY: number;
        moved: boolean;
    } | null>(null);

    const onHandleMouseDown = useCallback(
        (event: MouseEvent) => {
            // Stop the gesture before React Flow's pane sees it; otherwise a
            // drag from the header would also pan the canvas.
            event.stopPropagation();
            if (event.button !== 0 || !ctx) {
                return;
            }
            dragRef.current = {
                startX: event.clientX,
                startY: event.clientY,
                lastX: event.clientX,
                lastY: event.clientY,
                moved: false,
            };

            // The window event is the DOM `MouseEvent`, not React's synthetic
            // type that's imported above; we only need clientX/clientY.
            const onWindowMouseMove = (ev: { clientX: number; clientY: number }) => {
                const drag = dragRef.current;
                if (!drag) {
                    return;
                }
                const totalDx = ev.clientX - drag.startX;
                const totalDy = ev.clientY - drag.startY;
                if (!drag.moved) {
                    if (Math.hypot(totalDx, totalDy) < DRAG_THRESHOLD_PX) {
                        return;
                    }
                    drag.moved = true;
                }
                const incDx = ev.clientX - drag.lastX;
                const incDy = ev.clientY - drag.lastY;
                drag.lastX = ev.clientX;
                drag.lastY = ev.clientY;
                const zoom = ctx.getZoom() || 1;
                ctx.moveGroup(id, incDx / zoom, incDy / zoom);
            };

            const onWindowMouseUp = () => {
                window.removeEventListener('mousemove', onWindowMouseMove);
                window.removeEventListener('mouseup', onWindowMouseUp);
                // Don't clear dragRef here — the click event fires next and
                // needs to read `moved` to decide whether to suppress the
                // collapse. The click handler clears it.
            };

            window.addEventListener('mousemove', onWindowMouseMove);
            window.addEventListener('mouseup', onWindowMouseUp);
        },
        [ctx, id],
    );

    const onHandleClick = useCallback(
        (event: MouseEvent) => {
            // Always swallow the click so React Flow's wrapper-level onClick
            // doesn't double-fire onSubgraphNodeClick — we drive the toggle
            // ourselves with full information about whether the gesture was a
            // drag or a click.
            event.stopPropagation();
            const drag = dragRef.current;
            dragRef.current = null;
            if (drag?.moved) {
                return;
            }
            ctx?.toggleNamespace(data.namespace);
        },
        [ctx, data.namespace],
    );

    return (
        <div className={`mlir-group-body${isSection ? ' is-section' : ''}`}>
            {/* Header doubles as the collapse button and the drag handle. The
                `nopan`/`nodrag` classes (matched by RF's runtime filters) plus
                onMouseDown stopPropagation prevent the gesture from leaking to
                the pane. Click + drag are disambiguated locally via dragRef. */}
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
            <div
                className='mlir-group-handle nopan nodrag'
                title='Click to collapse · drag to move'
                onMouseDown={onHandleMouseDown}
                onClick={onHandleClick}
            >
                <span
                    className='mlir-group-handle-icon'
                    aria-hidden='true'
                >
                    ▾
                </span>
                <span className='mlir-group-handle-name'>{data.displayName ?? data.label}</span>
                <span className='mlir-group-handle-count'>{countText}</span>
                <span
                    className='mlir-group-handle-grip'
                    aria-hidden='true'
                    title='Drag to move'
                >
                    ⋮⋮
                </span>
            </div>
        </div>
    );
});

function builtGraphToReactFlow(built: BuiltGraph): { nodes: MLNode[]; edges: Edge[] } {
    const nodes: MLNode[] = built.nodes.map((n) => ({
        ...n,
        type: n.type === 'mlirGroup' ? 'mlirGroup' : 'mlirOp',
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
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const selectedNodeIdRef = useRef<string | null>(null);
    const viewportAnchorRef = useRef<{
        toNodeId: string;
        fromPosition: { x: number; y: number };
    } | null>(null);
    const hasFitInitiallyRef = useRef(false);
    const postedGraphIdRef = useRef<string | null>(null);
    const workerRef = useRef<Worker | null>(null);
    const nextRequestIdRef = useRef(0);
    const activeRequestIdRef = useRef(0);

    useEffect(() => {
        hasFitInitiallyRef.current = false;
        setExpandedNamespaces(new Set());
        viewportAnchorRef.current = null;
        setInteractionIndex(null);
        setSelectedNodeId(null);
    }, [graph.id]);

    useEffect(() => {
        selectedNodeIdRef.current = selectedNodeId;
    }, [selectedNodeId]);

    // Reflect selectedNodeId onto each node's `selected` flag so React Flow
    // applies its built-in selected styling.
    useEffect(() => {
        setNodes((current) => {
            let changed = false;
            const next = current.map((n) => {
                const shouldSelect = n.id === selectedNodeId;
                if (!!n.selected === shouldSelect) {
                    return n;
                }
                changed = true;
                return { ...n, selected: shouldSelect };
            });
            return changed ? next : current;
        });
    }, [selectedNodeId, setNodes]);

    const applyBuiltGraph = useCallback(
        (built: BuiltGraph) => {
            const rf = builtGraphToReactFlow(built);
            const selId = selectedNodeIdRef.current;
            const styledNodes = selId ? rf.nodes.map((n) => (n.id === selId ? { ...n, selected: true } : n)) : rf.nodes;
            setNodes(styledNodes);
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
            postedGraphIdRef.current = null;
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
            if (message.type === 'error') {
                if (message.requestId !== 0 && message.requestId !== activeRequestIdRef.current) {
                    return;
                }
                // eslint-disable-next-line no-console
                console.error('mlir layout worker:', message.error);
                return;
            }
            if (message.requestId !== activeRequestIdRef.current) {
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
                type: 'build' as const,
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
        if (postedGraphIdRef.current === graph.id) {
            return;
        }
        postedGraphIdRef.current = graph.id;
        setIndexReadyGraphId(null);
        const sourceNodes: SourceNode[] = graph.nodes.map((node) => ({
            id: node.id,
            label: node.label,
            namespace: node.namespace,
            attrs: node.attrs,
            incomingEdges: node.incomingEdges,
            outputsMetadata: node.outputsMetadata,
            config: node.config,
        }));
        worker.postMessage({
            type: 'set-graph',
            graphId: graph.id,
            nodes: sourceNodes,
        });
    }, [graph.id, graph.nodes]);

    const onSubgraphNodeClick = useCallback(
        (event: MouseEvent, node: MLNode) => {
            // For group nodes, only the header (`.mlir-group-handle`) is a click
            // target; clicks on the empty group body should be ignored. The
            // header doubles as the React Flow drag handle, so an actual drag
            // never fires `onNodeClick`.
            if (node.type === 'mlirGroup') {
                const target = event.target as Element | null;
                const headerHit = target?.closest?.('.mlir-group-handle');
                if (!headerHit) {
                    return;
                }
            } else {
                setSelectedNodeId(node.id);
            }
            // Trust the worker's decision on which clicks toggle a subgraph.
            // The worker explicitly omits `collapsedSubgraphNamespace` when a
            // node should NOT act as a toggle (e.g. the inner anchor of its
            // own already-expanded group — the group header handles collapse).
            const toggleNamespace =
                node.type === 'mlirGroup' ? node.data?.namespace : node.data?.collapsedSubgraphNamespace;
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

    const onPaneClick = useCallback(() => {
        setSelectedNodeId(null);
    }, []);

    // Group header invokes this on click (drag suppresses it). Mirrors the
    // collapse path of `onSubgraphNodeClick` for `mlirGroup` nodes: the
    // namespace is currently expanded, so we anchor from the group's own
    // position to its anchor op (which becomes visible after collapse) and
    // remove the namespace from `expandedNamespaces`.
    const toggleNamespaceFromGroup = useCallback(
        (namespace: string) => {
            const groupNode = nodes.find((n) => n.type === 'mlirGroup' && n.data?.namespace === namespace);
            const anchorNodeId = interactionIndex?.anchorByNamespace[namespace];
            const fromPosition = groupNode ? { x: groupNode.position.x, y: groupNode.position.y } : { x: 0, y: 0 };
            if (anchorNodeId) {
                viewportAnchorRef.current = { toNodeId: anchorNodeId, fromPosition };
            }
            setExpandedNamespaces((prev) => {
                if (!prev.has(namespace)) {
                    return prev;
                }
                const next = new Set(prev);
                next.delete(namespace);
                return next;
            });
        },
        [interactionIndex, nodes],
    );

    // Header drag updates only the group's own position; React Flow auto-
    // moves children because they declare `parentId` + `extent: 'parent'`.
    const moveGroup = useCallback(
        (groupId: string, dx: number, dy: number) => {
            setNodes((current) =>
                current.map((n) =>
                    n.id === groupId ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n,
                ),
            );
        },
        [setNodes],
    );

    const groupContextValue = useMemo<MlirGroupContextValue>(
        () => ({
            toggleNamespace: toggleNamespaceFromGroup,
            moveGroup,
            getZoom: () => getViewport().zoom,
        }),
        [toggleNamespaceFromGroup, moveGroup, getViewport],
    );

    const nodeTypes = useMemo(() => ({ mlirOp: MlirOpNode, mlirGroup: MlirGroupNode }) as const, []);

    // Edge filter:
    // - Internal edges (both endpoints inside the same expanded community): shown
    // - Pure top-level edges (neither endpoint inside an expanded community):
    //   shown — these are the community-to-community edges in the collapsed view
    // - Cross-boundary edges (one or both endpoints inside an expanded community,
    //   but not the same one): hidden by default; shown end-to-end with label
    //   only when one endpoint is the currently selected node.
    const displayedEdges = useMemo<Edge[]>(() => {
        if (edges.length === 0) {
            return edges;
        }
        const nodeById = new Map<string, MLNode>(nodes.map((n) => [n.id, n]));
        const result: Edge[] = [];
        for (const e of edges) {
            const srcParent = nodeById.get(e.source)?.parentId;
            const tgtParent = nodeById.get(e.target)?.parentId;
            if (srcParent && srcParent === tgtParent) {
                result.push(e);
                continue;
            }
            if (!srcParent && !tgtParent) {
                result.push(e);
                continue;
            }
            const srcIsSelected = e.source === selectedNodeId;
            const tgtIsSelected = e.target === selectedNodeId;
            if (srcIsSelected || tgtIsSelected) {
                result.push(e);
            }
        }
        return result;
    }, [edges, nodes, selectedNodeId]);

    // Focus context: the selected node, its directly connected neighbours, and
    // the edges that connect them. Held as derived state so the rest of the
    // component (and any future side panels) can render details about the
    // current focus without re-walking the edge list.
    const focusedConnections = useMemo(() => {
        const inputNodeIds = new Set<string>();
        const outputNodeIds = new Set<string>();
        const inputEdgeIds = new Set<string>();
        const outputEdgeIds = new Set<string>();
        if (selectedNodeId) {
            for (const e of displayedEdges) {
                if (e.target === selectedNodeId) {
                    inputNodeIds.add(e.source);
                    inputEdgeIds.add(e.id);
                }
                if (e.source === selectedNodeId) {
                    outputNodeIds.add(e.target);
                    outputEdgeIds.add(e.id);
                }
            }
        }
        return { inputNodeIds, outputNodeIds, inputEdgeIds, outputEdgeIds };
    }, [displayedEdges, selectedNodeId]);

    // Highlight input neighbours green and output neighbours yellow. The
    // selected node itself gets its blue ring from CSS (`.selected`).
    const styledNodes = useMemo<MLNode[]>(() => {
        if (!selectedNodeId) {
            return nodes;
        }
        const { inputNodeIds, outputNodeIds } = focusedConnections;
        if (inputNodeIds.size === 0 && outputNodeIds.size === 0) {
            return nodes;
        }
        return nodes.map((n) => {
            if (inputNodeIds.has(n.id)) {
                return { ...n, style: { ...(n.style ?? {}), background: GRAPH_COLORS.inputNode } };
            }
            if (outputNodeIds.has(n.id)) {
                return { ...n, style: { ...(n.style ?? {}), background: GRAPH_COLORS.outputNode } };
            }
            return n;
        });
    }, [nodes, focusedConnections, selectedNodeId]);

    // Colorize incoming edges green, outgoing edges yellow.
    const styledEdges = useMemo<Edge[]>(() => {
        if (!selectedNodeId) {
            return displayedEdges;
        }
        const { inputEdgeIds, outputEdgeIds } = focusedConnections;
        if (inputEdgeIds.size === 0 && outputEdgeIds.size === 0) {
            return displayedEdges;
        }
        return displayedEdges.map((e) => {
            if (inputEdgeIds.has(e.id)) {
                return {
                    ...e,
                    style: { ...(e.style ?? {}), stroke: GRAPH_COLORS.inputEdge, strokeWidth: 2 },
                    markerEnd:
                        typeof e.markerEnd === 'object' && e.markerEnd
                            ? { ...e.markerEnd, color: GRAPH_COLORS.inputEdge }
                            : e.markerEnd,
                };
            }
            if (outputEdgeIds.has(e.id)) {
                return {
                    ...e,
                    style: { ...(e.style ?? {}), stroke: GRAPH_COLORS.outputEdge, strokeWidth: 2 },
                    markerEnd:
                        typeof e.markerEnd === 'object' && e.markerEnd
                            ? { ...e.markerEnd, color: GRAPH_COLORS.outputEdge }
                            : e.markerEnd,
                };
            }
            return e;
        });
    }, [displayedEdges, focusedConnections, selectedNodeId]);

    return (
        <div style={{ width: '100%', height: 'calc(100vh - 92px - 30px - 56px - 40px)' }}>
            <MlirGroupContext.Provider value={groupContextValue}>
                <ReactFlow
                    nodes={styledNodes}
                    edges={styledEdges}
                    onNodeClick={onSubgraphNodeClick}
                    onPaneClick={onPaneClick}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    nodeTypes={nodeTypes}
                    minZoom={0.003}
                    maxZoom={1.5}
                    fitView
                    onlyRenderVisibleElements
                    connectionLineType={ConnectionLineType.SmoothStep}
                    selectNodesOnDrag={false}
                >
                    <MiniMap />
                    <Controls />
                    <Background />
                </ReactFlow>
            </MlirGroupContext.Provider>

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
