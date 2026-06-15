// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/* eslint-disable no-void */
/* eslint-disable react/prop-types */
/* eslint-disable no-continue */
/* eslint-disable no-nested-ternary */

import {
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
import type {
    BuiltGraph,
    IncomingEdgeView,
    IndexedPortMetadata,
    OutgoingEdge,
    SourceNode,
    WorkerNode,
} from './mlirGraphTypes';
import { GRAPH_COLORS } from '../../definitions/GraphColors';
import { useMlirLayoutWorker } from './useMlirLayoutWorker';
import MlirNodeDetailsPanel from './MlirNodeDetailsPanel';
import { getNamespaceSegments } from './mlirGraphHelpers';

// Re-uses `WorkerNode['data']` (the canonical shape produced by the layout
// worker) and tacks on `highlight` — a view-layer-only flag. Set when this
// node is a producer/consumer of the currently selected node. Op nodes get a
// coloured fill via `style.background`; groups route the highlight through
// `data.highlight` so the dashed body border is colourised instead, because
// painting the wrapper background bleeds behind the body and hides children.
type MLNodeData = WorkerNode['data'] & { highlight?: 'input' | 'output' };

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

    // When this group is a producer/consumer of the selected node, swap the
    // body's neutral border colour for the highlight colour (and bump the
    // weight slightly so it's visible against the existing dashed pattern).
    // We deliberately don't touch the wrapper's background — the dashed body
    // sits on top of a transparent wrapper, so wrapper-level fills bleed into
    // the canvas behind the body and obscure the group's children.
    const highlightColor =
        data.highlight === 'input'
            ? GRAPH_COLORS.inputNode
            : data.highlight === 'output'
              ? GRAPH_COLORS.outputNode
              : undefined;
    const bodyStyle = highlightColor ? { borderColor: highlightColor, borderStyle: 'solid' as const } : undefined;

    return (
        <div
            className={`mlir-group-body${isSection ? ' is-section' : ''}`}
            style={bodyStyle}
        >
            {/* Group nodes need explicit handles so React Flow has somewhere
                to attach edges that aggregate to the group boundary (e.g. a
                top-level op connecting to an op buried inside this expanded
                group). Without handles the edges silently render as no-ops. */}
            <Handle
                type='target'
                position={Position.Top}
                isConnectable={false}
                className='mlir-group-handle-port'
            />
            <Handle
                type='source'
                position={Position.Bottom}
                isConnectable={false}
                className='mlir-group-handle-port'
            />
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

const MlGraphInner = ({ data }: ViewProps) => {
    const { fitView, getViewport, setViewport } = useReactFlow();
    const graph = data.graphs[0];
    const [nodes, setNodes, onNodesChange] = useNodesState<MLNode>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [expandedNamespaces, setExpandedNamespaces] = useState<Set<string>>(() => new Set());
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const selectedNodeIdRef = useRef<string | null>(null);
    const viewportAnchorRef = useRef<{
        toNodeId: string;
        fromPosition: { x: number; y: number };
    } | null>(null);
    // Set by `navigateToNode` when the target lives inside one or more
    // collapsed namespaces and we have to wait for the worker to rebuild
    // before we can fitView on it. Consumed once the rebuilt graph lands.
    const pendingFocusNodeIdRef = useRef<string | null>(null);
    const hasFitInitiallyRef = useRef(false);

    // No graph-id reset effect: `MlGraphInner` is keyed by `graph.id` in
    // `MlGraphWithProvider`, so React fully remounts the subtree when the
    // graph changes. That gives us a fresh worker, fresh refs, and fresh
    // state for free without an in-effect setState (which would trip
    // react-hooks/set-state-in-effect).

    useEffect(() => {
        selectedNodeIdRef.current = selectedNodeId;
    }, [selectedNodeId]);

    // `pendingFocusNodeIdRef` is a one-shot baton armed by `navigateToNode`
    // when the locate target lives in a collapsed namespace and consumed by
    // `applyBuiltGraph` after the worker rebuild. If the user changes the
    // selection in the meantime (clicks another node, clicks empty space),
    // the user's intent has moved on — drop the baton so the rebuild
    // doesn't jerk the viewport to a stale target. Back-to-back "Locate"
    // clicks don't go through here: `navigateToNode` overwrites the ref
    // directly and doesn't touch selection, so the latest target wins
    // without any effect firing.
    useEffect(() => {
        pendingFocusNodeIdRef.current = null;
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

            // Locate-from-panel: the user clicked the "locate" button next to
            // a producer/consumer reference and the target wasn't visible
            // pre-rebuild (collapsed namespace). Now that the rebuilt graph
            // has landed, recenter on it. Skip silently if the target still
            // isn't in the build (e.g. synthetic id that never reaches the
            // canvas) — a missing fitView is preferable to a noisy error,
            // and the surrounding state stays consistent because navigation
            // never touches selection.
            const pendingFocusId = pendingFocusNodeIdRef.current;
            if (pendingFocusId) {
                pendingFocusNodeIdRef.current = null;
                if (rf.nodes.some((n) => n.id === pendingFocusId)) {
                    requestAnimationFrame(() => {
                        void fitView({
                            nodes: [{ id: pendingFocusId }],
                            padding: 0.3,
                            duration: 200,
                        });
                    });
                }
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

    // The view component owns React Flow / viewport / selection state; the
    // worker hook owns the wire protocol. We hand `applyBuiltGraph` to the
    // hook so freshly-built graphs land back here for styling + fitView.
    const sourceNodes = useMemo<SourceNode[]>(
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
    const { interactionIndex, runBuild } = useMlirLayoutWorker(graph.id, sourceNodes, applyBuiltGraph);

    useEffect(() => {
        runBuild(expandedNamespaces);
    }, [expandedNamespaces, runBuild]);

    // Anchor the viewport so the namespace's representative op (post-collapse)
    // visually stays put, then drop the namespace from `expandedNamespaces`.
    // `fromPosition` is the screen-space position of the gesture origin (the
    // clicked group header, or the parent group of a click on a nested op).
    const collapseNamespace = useCallback(
        (namespace: string, fromPosition: { x: number; y: number }) => {
            const anchorNodeId = interactionIndex?.anchorByNamespace[namespace];
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
        [interactionIndex],
    );

    // Anchor the viewport so the group wrapper appears where the user clicked,
    // then add the namespace to `expandedNamespaces`. Group nodes are always
    // synthesised at id `group:<namespace>`, so we anchor directly to that id —
    // there's no need to consult `interactionIndex.anchorByNamespace` here.
    const expandNamespace = useCallback((namespace: string, fromPosition: { x: number; y: number }) => {
        viewportAnchorRef.current = {
            toNodeId: `group:${namespace}`,
            fromPosition,
        };
        setExpandedNamespaces((prev) => {
            if (prev.has(namespace)) {
                return prev;
            }
            const next = new Set(prev);
            next.add(namespace);
            return next;
        });
    }, []);

    const onSubgraphNodeClick = useCallback(
        (event: MouseEvent, node: MLNode) => {
            // For group nodes, only the header (`.mlir-group-handle`) is a click
            // target; clicks on the empty group body behave like a pane click —
            // they clear any current selection. Without this, React Flow's
            // built-in selection logic deselects the previously-selected leaf
            // (the blue ring vanishes) while our `selectedNodeId` state stays
            // set, leaving the producer/consumer highlights stuck on.
            if (node.type === 'mlirGroup') {
                const target = event.target as Element | null;
                const headerHit = target?.closest?.('.mlir-group-handle');
                if (!headerHit) {
                    setSelectedNodeId(null);
                    return;
                }
            }
            // Trust the worker's decision on which clicks toggle a subgraph.
            // The worker explicitly omits `collapsedSubgraphNamespace` when a
            // node should NOT act as a toggle (e.g. the inner anchor of its
            // own already-expanded group — the group header handles collapse).
            const toggleNamespace =
                node.type === 'mlirGroup' ? node.data?.namespace : node.data?.collapsedSubgraphNamespace;
            // A click on a "toggle node" (an mlirGroup header, or an op node
            // whose body acts as a collapsed-namespace anchor) is a structural
            // navigation gesture — expand/collapse only. Don't treat it as a
            // selection too: a collapsed section anchor stands in for hundreds
            // of inner ops, so highlighting its aggregated edges floods the
            // canvas and is not what the user intended. Selection is reserved
            // for actual leaf ops (no collapsedSubgraphNamespace).
            if (!toggleNamespace && node.type !== 'mlirGroup') {
                setSelectedNodeId(node.id);
            }
            if (!toggleNamespace) {
                return;
            }
            if (expandedNamespaces.has(toggleNamespace)) {
                // Collapsing a nested op: anchor from the surrounding parent
                // group (its position is what's visible after collapse), not
                // from the inner op which is about to disappear.
                let fromPosition = { x: node.position.x, y: node.position.y };
                if (node.parentId) {
                    const parentNode = nodes.find((n) => n.id === node.parentId);
                    if (parentNode) {
                        fromPosition = { x: parentNode.position.x, y: parentNode.position.y };
                    }
                }
                collapseNamespace(toggleNamespace, fromPosition);
            } else {
                expandNamespace(toggleNamespace, { x: node.position.x, y: node.position.y });
            }
        },
        [
            //
            collapseNamespace,
            expandNamespace,
            expandedNamespaces,
            nodes,
        ],
    );

    const onPaneClick = useCallback(() => {
        setSelectedNodeId(null);
    }, []);

    // Group header invokes this on click (drag suppresses it). Always a
    // collapse — the header only exists for an expanded group.
    const toggleNamespaceFromGroup = useCallback(
        (namespace: string) => {
            const groupNode = nodes.find((n) => n.type === 'mlirGroup' && n.data?.namespace === namespace);
            const fromPosition = groupNode ? { x: groupNode.position.x, y: groupNode.position.y } : { x: 0, y: 0 };
            collapseNamespace(namespace, fromPosition);
        },
        [collapseNamespace, nodes],
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

    // Look up the canonical SourceNode for the current selection so the
    // details panel reads from the same authoritative shape that drove the
    // graph build. `sourceNodes` is already memoised above, so this map is
    // rebuilt only when the underlying graph changes.
    const sourceNodeById = useMemo(() => {
        const result = new Map<string, SourceNode>();
        for (const sourceNode of sourceNodes) {
            result.set(sourceNode.id, sourceNode);
        }
        return result;
    }, [sourceNodes]);

    const selectedSourceNode = selectedNodeId ? (sourceNodeById.get(selectedNodeId) ?? null) : null;

    // Region partnership maps for expanded namespaces. The layout worker
    // remaps cross-region edges in two symmetric ways when a namespace is
    // expanded:
    //
    //   - Outputs: edges conceptually flowing OUT of the region's anchor op
    //     (e.g. `stablehlo.reduce`) are rendered as sourced from the
    //     terminator (e.g. `stablehlo.return`). The anchor carries
    //     `outputsMetadata`; the terminator carries the rendered consumer
    //     edges. Bonded bidirectionally so selecting either side surfaces
    //     the same data.
    //
    //   - Inputs: edges conceptually flowing INTO the anchor op are rendered
    //     as targeting the namespace's inner input-arg node for the matching
    //     port (`namespaceInputByNamespace[ns][portIdx]`). To surface those
    //     under the anchor's Inputs section, we keep an inverse map from
    //     arg id → the anchor + port index it represents.
    //
    // `anchorByNamespace` is the right key here: it maps every namespace
    // (top-level or nested) to its representative op. `outerNamespaceByNodeId`
    // only records *parent-level toggles* (an op in the parent namespace
    // that controls a child), so it silently misses top-level regions whose
    // anchor lives inside the namespace — which is exactly the case for ops
    // like a top-level `stablehlo.all_reduce_N`. All three maps are populated
    // only for expanded namespaces; collapsed regions need no pairing.
    const { regionOutputPartnerByNodeId, inputArgIdxByArgIdByAnchor } = useMemo<{
        regionOutputPartnerByNodeId: Map<string, string>;
        inputArgIdxByArgIdByAnchor: Map<string, Map<string, number>>;
    }>(() => {
        const outputPartner = new Map<string, string>();
        const inputArgsByAnchor = new Map<string, Map<string, number>>();
        if (!interactionIndex) {
            return {
                regionOutputPartnerByNodeId: outputPartner,
                inputArgIdxByArgIdByAnchor: inputArgsByAnchor,
            };
        }
        for (const namespace of expandedNamespaces) {
            const anchorNodeId = interactionIndex.anchorByNamespace[namespace];
            if (!anchorNodeId) {
                continue;
            }
            const returnNodeId = interactionIndex.namespaceReturnNodeByNamespace[namespace];
            if (returnNodeId && returnNodeId !== anchorNodeId) {
                outputPartner.set(anchorNodeId, returnNodeId);
                outputPartner.set(returnNodeId, anchorNodeId);
            }
            const inputArgs = interactionIndex.namespaceInputByNamespace[namespace];
            if (inputArgs && inputArgs.length > 0) {
                const argToIdx = new Map<string, number>();
                inputArgs.forEach((argId, idx) => argToIdx.set(argId, idx));
                inputArgsByAnchor.set(anchorNodeId, argToIdx);
            }
        }
        return {
            regionOutputPartnerByNodeId: outputPartner,
            inputArgIdxByArgIdByAnchor: inputArgsByAnchor,
        };
    }, [interactionIndex, expandedNamespaces]);

    // Both panel I/O sections read from the React Flow `edges` array — i.e.
    // the connections actually drawn on the canvas — rather than from the
    // source-data inversion. Terminator ops (e.g. `stablehlo.return`) have
    // outgoing arrows that the layout worker synthesises for region plumbing
    // but that never round-trip through the raw graph JSON, so the source-
    // data inversion would miss them. The edge `label` carries the tensor
    // shape (e.g. "[7, 3072] bf16"), and for inputs we additionally enrich
    // with the producer's `outputsMetadata` for the relevant source port —
    // that's the per-port shape/dtype/`__tensor_tag` payload that flows
    // along the wire.
    //
    // Index `edges` once per build by source-id and target-id so each
    // selection change is O(degree of selected node) instead of O(|E|).
    // MLIR graphs can run into the tens of thousands of edges; without
    // these indices, every node click would re-walk the whole edge list.
    const { outgoingEdgesByNodeId, incomingEdgesByNodeId } = useMemo<{
        outgoingEdgesByNodeId: Map<string, Edge[]>;
        incomingEdgesByNodeId: Map<string, Edge[]>;
    }>(() => {
        const outgoing = new Map<string, Edge[]>();
        const incoming = new Map<string, Edge[]>();
        for (const edge of edges) {
            const fromBucket = outgoing.get(edge.source);
            if (fromBucket) {
                fromBucket.push(edge);
            } else {
                outgoing.set(edge.source, [edge]);
            }
            const toBucket = incoming.get(edge.target);
            if (toBucket) {
                toBucket.push(edge);
            } else {
                incoming.set(edge.target, [edge]);
            }
        }
        return { outgoingEdgesByNodeId: outgoing, incomingEdgesByNodeId: incoming };
    }, [edges]);

    // Per-node output-port lookup so incoming-edge enrichment can grab the
    // producer's port metadata in O(1) instead of `find()`-ing through the
    // producer's `outputsMetadata` array on every edge.
    const outputsPortMetadataByNodeIdAndPortId = useMemo<Map<string, Map<string, IndexedPortMetadata>>>(() => {
        const result = new Map<string, Map<string, IndexedPortMetadata>>();
        for (const sourceNode of sourceNodes) {
            if (sourceNode.outputsMetadata.length === 0) {
                continue;
            }
            const portMap = new Map<string, IndexedPortMetadata>();
            for (const port of sourceNode.outputsMetadata) {
                portMap.set(port.id, port);
            }
            result.set(sourceNode.id, portMap);
        }
        return result;
    }, [sourceNodes]);

    const selectedOutgoingEdges = useMemo<OutgoingEdge[]>(() => {
        if (!selectedNodeId) {
            return [];
        }
        // Also pick up edges sourced from the region-output partner so that
        // selecting either side of the (outer op ↔ terminator) pair surfaces
        // the same consumers.
        const partnerNodeId = regionOutputPartnerByNodeId.get(selectedNodeId);
        const buckets: Edge[][] = [];
        const selfBucket = outgoingEdgesByNodeId.get(selectedNodeId);
        if (selfBucket) {
            buckets.push(selfBucket);
        }
        if (partnerNodeId) {
            const partnerBucket = outgoingEdgesByNodeId.get(partnerNodeId);
            if (partnerBucket) {
                buckets.push(partnerBucket);
            }
        }
        // De-dupe on the tuple the user actually reads off the row
        // (target node + source output port + target input port). The
        // self and partner buckets can both surface the same logical
        // wire when the worker's `addEdgeSafe` keeps two edge ids that
        // share an endpoint tuple (its id-dedup only blocks exact id
        // collisions, and pair-dedup is bypassed for non-top-level
        // endpoints). Without this guard the Outputs section renders
        // duplicated consumer rows for region-pair selections.
        const result: OutgoingEdge[] = [];
        const seenKeys = new Set<string>();
        for (const bucket of buckets) {
            for (const edge of bucket) {
                const sourceOutputId = edge.sourceHandle ?? '0';
                const targetInputId = edge.targetHandle ?? '0';
                const key = `${edge.target}|${sourceOutputId}|${targetInputId}`;
                if (seenKeys.has(key)) {
                    continue;
                }
                seenKeys.add(key);
                result.push({
                    targetNodeId: edge.target,
                    targetNodeLabel: sourceNodeById.get(edge.target)?.label ?? null,
                    sourceNodeOutputId: sourceOutputId,
                    targetNodeInputId: targetInputId,
                    label: typeof edge.label === 'string' ? edge.label : undefined,
                });
            }
        }
        return result;
    }, [outgoingEdgesByNodeId, selectedNodeId, regionOutputPartnerByNodeId, sourceNodeById]);

    // Output port metadata for the panel: the selected node's own metadata
    // when present, else the partner's. For a region's terminator (no own
    // `outputsMetadata`) this surfaces the outer op's port metadata, so the
    // Outputs section stays consistent across both sides of the pair.
    const selectedOutputsMetadata = useMemo<IndexedPortMetadata[]>(() => {
        if (!selectedSourceNode) {
            return [];
        }
        if (selectedSourceNode.outputsMetadata.length > 0) {
            return selectedSourceNode.outputsMetadata;
        }
        const partnerNodeId = regionOutputPartnerByNodeId.get(selectedSourceNode.id);
        if (!partnerNodeId) {
            return [];
        }
        return sourceNodeById.get(partnerNodeId)?.outputsMetadata ?? [];
    }, [selectedSourceNode, regionOutputPartnerByNodeId, sourceNodeById]);
    const selectedIncomingEdges = useMemo<IncomingEdgeView[]>(() => {
        if (!selectedNodeId) {
            return [];
        }
        // When the selection is the anchor op of an expanded region, the
        // layout worker has rewritten its cross-region incoming edges to land
        // on the inner input-arg nodes. Walk those args too and attribute
        // their edges back to the anchor's input port (the index of the
        // arg in `namespaceInputByNamespace[ns]`).
        const argIdxByArgId = inputArgIdxByArgIdByAnchor.get(selectedNodeId);
        // Build the (bucket, targetInputId resolver) pairs we need to walk.
        // Direct edges hitting the selection use their own targetHandle; arg
        // edges resolve to the anchor's input-port index via `argIdxByArgId`.
        const pairs: Array<{ bucket: Edge[]; resolveTargetInputId: (edge: Edge) => string | null }> = [];
        const selfBucket = incomingEdgesByNodeId.get(selectedNodeId);
        if (selfBucket) {
            pairs.push({
                bucket: selfBucket,
                resolveTargetInputId: (edge) => edge.targetHandle ?? '0',
            });
        }
        if (argIdxByArgId) {
            for (const [argNodeId, portIdx] of argIdxByArgId) {
                const argBucket = incomingEdgesByNodeId.get(argNodeId);
                if (argBucket) {
                    const portIdStr = String(portIdx);
                    pairs.push({
                        bucket: argBucket,
                        resolveTargetInputId: () => portIdStr,
                    });
                }
            }
        }
        // De-dupe on the tuple the user actually reads off the row
        // (producer + source output port + target input port). Distinct
        // worker edge ids can share this tuple — see the matching
        // comment on `selectedOutgoingEdges` — which otherwise surfaces
        // as duplicated rows in the Inputs section and an inflated
        // section count.
        const result: IncomingEdgeView[] = [];
        const seenKeys = new Set<string>();
        for (const { bucket, resolveTargetInputId } of pairs) {
            for (const edge of bucket) {
                const targetInputId = resolveTargetInputId(edge);
                if (targetInputId === null) {
                    continue;
                }
                const sourcePortId = edge.sourceHandle ?? '0';
                const key = `${edge.source}|${sourcePortId}|${targetInputId}`;
                if (seenKeys.has(key)) {
                    continue;
                }
                seenKeys.add(key);
                const producer = sourceNodeById.get(edge.source);
                const sourcePortMetadata =
                    outputsPortMetadataByNodeIdAndPortId.get(edge.source)?.get(sourcePortId) ?? null;
                result.push({
                    sourceNodeId: edge.source,
                    sourceNodeLabel: producer?.label ?? null,
                    sourceNodeOutputId: sourcePortId,
                    targetNodeInputId: targetInputId,
                    label: typeof edge.label === 'string' ? edge.label : undefined,
                    sourcePortMetadata,
                });
            }
        }
        return result;
    }, [
        incomingEdgesByNodeId,
        outputsPortMetadataByNodeIdAndPortId,
        selectedNodeId,
        sourceNodeById,
        inputArgIdxByArgIdByAnchor,
    ]);

    const closeDetailsPanel = useCallback(() => {
        setSelectedNodeId(null);
    }, []);

    const recenterOnSelected = useCallback(() => {
        if (!selectedNodeId) {
            return;
        }
        void fitView({ nodes: [{ id: selectedNodeId }], padding: 0.3, duration: 200 });
    }, [fitView, selectedNodeId]);

    // Click handler for the "locate" affordance next to each producer /
    // consumer reference in the details panel. This is a peek — it pans
    // the viewport to the linked node without changing the current
    // selection, so the panel stays on the originating op and the
    // input/output highlighting on the canvas doesn't churn.
    //
    // The target may live inside one or more collapsed namespaces, so we:
    //   1. Look it up in the source-data map. If unknown (e.g. a synthetic
    //      arg-node id that never appears as a SourceNode), bail.
    //   2. Walk the namespace chain and queue any ancestor prefixes — and
    //      the target's own namespace — that aren't already expanded. Every
    //      level must be expanded for the node to actually be rendered.
    //   3. If no expansion was needed, fitView straight away. Otherwise
    //      stash the id in `pendingFocusNodeIdRef` so the post-rebuild path
    //      in `applyBuiltGraph` recenters once the new nodes land.
    const navigateToNode = useCallback(
        (targetNodeId: string) => {
            const target = sourceNodeById.get(targetNodeId);
            if (!target) {
                return;
            }
            const segments = getNamespaceSegments(target.namespace);
            const prefixesToAdd: string[] = [];
            for (let i = 1; i <= segments.length; i++) {
                const prefix = segments.slice(0, i).join('/');
                if (!expandedNamespaces.has(prefix)) {
                    prefixesToAdd.push(prefix);
                }
            }
            if (prefixesToAdd.length === 0) {
                void fitView({ nodes: [{ id: targetNodeId }], padding: 0.3, duration: 200 });
                return;
            }
            pendingFocusNodeIdRef.current = targetNodeId;
            setExpandedNamespaces((prev) => {
                const next = new Set(prev);
                for (const prefix of prefixesToAdd) {
                    next.add(prefix);
                }
                return next;
            });
        },
        [expandedNamespaces, fitView, sourceNodeById],
    );

    // Edge display rules:
    // 1. Drop edges where either endpoint is a real-namespace group node.
    //    The worker's internal-edges loop emits these for nested expanded
    //    regions, but the top-level loop ALWAYS also emits the direct
    //    node-to-node alternative (e.g. `gather → arg42` is the direct twin
    //    of `gather → group:all_reduce_0`). Keeping both causes duplicate
    //    edges with disagreeing labels.
    // 2. Selection edges: when a node is selected, every edge touching it is
    //    shown end-to-end so the user can trace exact connections.
    // 3. Collapsed-to-collapsed edges: when both endpoints are collapsed
    //    namespace anchors, the edge represents an aggregated bundle of
    //    many inner connections. Drop the per-edge label and dedup by pair
    //    so we don't paint a stack of tensor shapes between two anchors.
    // 4. Same-parent edges (otherwise): shown end-to-end with their label.
    // 5. Cross-boundary edges: lift each endpoint to the level just below
    //    the lowest common ancestor of the two parent chains, then on each
    //    side independently if the lifted endpoint is a *real* MLIR
    //    namespace group (not a synthetic topology section), drop the lift
    //    and use the actual node. This gives direct node-to-node edges for
    //    region boundaries while preserving the aggregate "section A →
    //    section B" rendering for high-fan-out synthetic sections. Aggregate
    //    pairs are de-duplicated.
    const displayedEdges = useMemo<Edge[]>(() => {
        if (edges.length === 0) {
            return edges;
        }
        const nodeById = new Map<string, MLNode>(nodes.map((n) => [n.id, n]));
        // Memoise parent-id chains so a heavily-nested edge endpoint doesn't
        // re-walk the same ancestors O(edges) times.
        const chainCache = new Map<string, string[]>();
        const parentChain = (nodeId: string): string[] => {
            const cached = chainCache.get(nodeId);
            if (cached) {
                return cached;
            }
            const chain: string[] = [];
            let pid = nodeById.get(nodeId)?.parentId;
            while (pid) {
                chain.push(pid);
                pid = nodeById.get(pid)?.parentId;
            }
            chain.reverse();
            chainCache.set(nodeId, chain);
            return chain;
        };
        const isRealNamespaceGroup = (id: string): boolean => {
            const n = nodeById.get(id);
            return n?.type === 'mlirGroup' && n.data?.groupKind !== 'section';
        };
        const isCollapsedAnchor = (id: string): boolean => {
            const n = nodeById.get(id);
            return !!n?.data?.collapsedSubgraphNamespace && n.data?.subgraphToggleState === 'collapsed';
        };
        // LCA lift: for an edge whose endpoints live in different parent
        // chains, walk each chain down to the point just below their lowest
        // common ancestor. The lifted ids represent the edge's projection onto
        // that LCA boundary. Returns the *raw* lifted ids (no real-namespace
        // fallback yet — that happens at the call site, where rule 5 also
        // decides whether to keep the original endpoint).
        const liftToLCA = (srcId: string, tgtId: string): { liftedSrc: string; liftedTgt: string } => {
            const srcChain = parentChain(srcId);
            const tgtChain = parentChain(tgtId);
            let lcaDepth = 0;
            while (
                lcaDepth < srcChain.length &&
                lcaDepth < tgtChain.length &&
                srcChain[lcaDepth] === tgtChain[lcaDepth]
            ) {
                lcaDepth++;
            }
            return {
                liftedSrc: srcChain.length > lcaDepth ? srcChain[lcaDepth] : srcId,
                liftedTgt: tgtChain.length > lcaDepth ? tgtChain[lcaDepth] : tgtId,
            };
        };
        const result: Edge[] = [];
        const seenAggregatePairs = new Set<string>();
        const seenCollapsedPairs = new Set<string>();
        for (const e of edges) {
            // (1) Suppress redundant container-level edges for real
            // namespaces. We already emit the direct twin from the top-level
            // edge loop, so the group-boundary version is pure visual noise.
            if (isRealNamespaceGroup(e.source) || isRealNamespaceGroup(e.target)) {
                continue;
            }
            // (2) Selection wins over everything below — labels included.
            if (e.source === selectedNodeId || e.target === selectedNodeId) {
                result.push(e);
                continue;
            }
            // (3) Collapsed-to-collapsed: aggregated bundle, no label, dedup.
            if (isCollapsedAnchor(e.source) && isCollapsedAnchor(e.target)) {
                const pairKey = `${e.source}|${e.target}`;
                if (seenCollapsedPairs.has(pairKey)) {
                    continue;
                }
                seenCollapsedPairs.add(pairKey);
                result.push({ ...e, label: undefined });
                continue;
            }
            const srcParent = nodeById.get(e.source)?.parentId;
            const tgtParent = nodeById.get(e.target)?.parentId;
            // (4) Same-parent — push as-is.
            if (srcParent === tgtParent) {
                result.push(e);
                continue;
            }
            // (5) Cross-boundary — LCA lift with real-namespace fallback.
            const { liftedSrc, liftedTgt } = liftToLCA(e.source, e.target);
            const finalSrc = isRealNamespaceGroup(liftedSrc) ? e.source : liftedSrc;
            const finalTgt = isRealNamespaceGroup(liftedTgt) ? e.target : liftedTgt;
            if (finalSrc === finalTgt) {
                continue;
            }
            if (finalSrc === e.source && finalTgt === e.target) {
                result.push(e);
                continue;
            }
            const pairKey = `${finalSrc}|${finalTgt}`;
            if (seenAggregatePairs.has(pairKey)) {
                continue;
            }
            seenAggregatePairs.add(pairKey);
            result.push({
                ...e,
                id: `agg:${pairKey}`,
                source: finalSrc,
                target: finalTgt,
                label: undefined,
            });
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

    // Highlight input neighbours green and output neighbours yellow. Op nodes
    // get a colored fill via `style.background`; group nodes route the
    // highlight through `data.highlight` so their body border is colorized
    // instead — painting the wrapper background on a group bleeds behind the
    // dashed body and hides the children inside. The selected node itself
    // still gets its blue ring from CSS (`.selected`).
    const styledNodes = useMemo<MLNode[]>(() => {
        if (!selectedNodeId) {
            return nodes;
        }
        const { inputNodeIds, outputNodeIds } = focusedConnections;
        if (inputNodeIds.size === 0 && outputNodeIds.size === 0) {
            return nodes;
        }
        return nodes.map((n) => {
            const role: 'input' | 'output' | undefined = inputNodeIds.has(n.id)
                ? 'input'
                : outputNodeIds.has(n.id)
                  ? 'output'
                  : undefined;
            if (!role) {
                return n;
            }
            const color = role === 'input' ? GRAPH_COLORS.inputNode : GRAPH_COLORS.outputNode;
            if (n.type === 'mlirGroup') {
                return { ...n, data: { ...n.data, highlight: role } };
            }
            return { ...n, style: { ...(n.style ?? {}), background: color } };
        });
    }, [nodes, focusedConnections, selectedNodeId]);

    // MiniMap reads `node.style.background` to colour each mini-node. The
    // unhighlighted op-node fill now lives in SCSS (`.react-flow__node-mlirOp`),
    // so without this callback the minimap would fall back to its CSS var —
    // which is the same `$tt-grey-2` as the minimap pane background, making
    // nodes invisible. Group wrappers stay transparent in the minimap because
    // their visible chrome is the inner `.mlir-group-body`, not the wrapper.
    const minimapNodeColor = useCallback((node: Node): string => {
        const inlineBg = (node.style as { background?: string } | undefined)?.background;
        if (typeof inlineBg === 'string' && inlineBg !== 'transparent') {
            return inlineBg;
        }
        if (node.type === 'mlirGroup') {
            return 'rgba(125, 125, 125, 0.35)';
        }
        return '#f5f5f5';
    }, []);

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
        <div className='mlir-view-pane'>
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
                    connectionLineType={ConnectionLineType.SmoothStep}
                    selectNodesOnDrag={false}
                >
                    <MiniMap nodeColor={minimapNodeColor} />
                    <Controls />
                    <Background />
                </ReactFlow>
            </MlirGroupContext.Provider>

            <Button
                className='mlir-relayout-button'
                onClick={() => runBuild(expandedNamespaces)}
            >
                Re-layout
            </Button>

            {selectedSourceNode && (
                <MlirNodeDetailsPanel
                    node={selectedSourceNode}
                    incomingEdges={selectedIncomingEdges}
                    outgoingEdges={selectedOutgoingEdges}
                    outputsMetadata={selectedOutputsMetadata}
                    onClose={closeDetailsPanel}
                    onRecenter={recenterOnSelected}
                    onNavigateToNode={navigateToNode}
                />
            )}
        </div>
    );
};

const MlGraphWithProvider = (props: ViewProps) => (
    <ReactFlowProvider>
        {/* Keying on graph.id remounts the inner subtree when the user
            switches graphs — cleaner than imperatively resetting half a
            dozen state slots in an effect, and lints cleanly under
            react-hooks/set-state-in-effect. */}
        <MlGraphInner
            // eslint-disable-next-line react/destructuring-assignment
            key={props.data.graphs[0]?.id}
            {...props}
        />
    </ReactFlowProvider>
);

export default MlGraphWithProvider;
