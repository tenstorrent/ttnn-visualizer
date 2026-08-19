// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
    Background,
    Controls,
    MarkerType,
    MiniMap,
    type NodeChange,
    ReactFlow,
    ReactFlowProvider,
    useEdgesState,
    useNodesState,
    useReactFlow,
    useStoreApi,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useAtomValue } from 'jotai';
import {
    type CSSProperties,
    type MouseEvent as ReactMouseEvent,
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { GraphFilterMode } from '../../definitions/GraphFilterMode';
import { NodeRelation } from '../../definitions/NodeRelation';
import { PerfOverlayStatus } from '../../definitions/PerfOverlayStatus';
import { toReadableShape } from '../../functions/formatting';
import { buildGraphFilterMatcher } from '../../functions/graphFilterMatcher';
import type { OperationDescription } from '../../model/APIData';
import { type PerfOverlaySource, perfColorScale } from '../../functions/perfOverlay';
import { activePerformanceReportAtom, activeProfilerReportAtom } from '../../store/app';
import type { GraphOpFilterHandle } from '../GraphOpFilter';
import LoadingSpinner from '../LoadingSpinner';
import PerfOverlayLegend from '../perf-overlay/PerfOverlayLegend';
import OpGraphEdge from './OpGraphEdge';
import OpGraphInfoPanel from './OpGraphInfoPanel';
import OpGraphNode from './OpGraphNode';
import OpGraphToolbar from './OpGraphToolbar';
import {
    PERF_BAR_ZOOM_VAR,
    buildOpGraphPerfOverlay,
    buildPerfNodeStyleByNodeId,
    getPerfHoverLabel,
    getQuantisedPerfZoom,
} from './opGraphPerfOverlay';
import { useOpGraphLayoutWorker } from './useOpGraphLayoutWorker';
import {
    type OpGraphBuildOptions,
    type OpGraphBuiltGraph,
    OpGraphEdgeType,
    type OpGraphFlowEdge,
    type OpGraphFlowNode,
    type OpGraphNodeIndexEntry,
    OpGraphNodeType,
    type OpGraphSourceOperation,
} from './opGraphTypes';
import 'styles/components/OperationGraphReactFlow.scss';

const NODE_TYPES = { [OpGraphNodeType.OP]: OpGraphNode };
const EDGE_TYPES = { [OpGraphEdgeType.OP]: OpGraphEdge };

const EDGE_MARKER = { type: MarkerType.ArrowClosed, width: 18, height: 18 } as const;

// A large report only fits at extreme zoom-out; 3 caps zoom-in as vis did.
const MAX_ZOOM = 3;
const MIN_ZOOM = 0.02;
const FOCUS_ZOOM = 1;
// Matches MLIR's `localJump`: stepping through matches retargets the tween on
// every press, so a longer one never settles and the camera reads as lagging.
const FOCUS_DURATION_MS = 200;

// The applied query lags the input so the match → style → React Flow diff chain
// doesn't run per keystroke. Clearing bypasses it to keep Escape instant.
const FILTER_DEBOUNCE_MS = 120;
// Session-scoped: survives a reload without leaking across browser sessions.
const FILTER_MODE_STORAGE_KEY = 'opGraphFilterMode';

interface OpGraphMatches {
    ids: Set<string>;
    operationIdsInOrder: number[];
}

// Shared so an idle filter yields one stable identity instead of a fresh empty
// set per render, which would invalidate every memo downstream.
const EMPTY_MATCHES: OpGraphMatches = { ids: new Set<string>(), operationIdsInOrder: [] };

const SELECTED_NODE_CLASS = 'op-graph-node-selected';

// Filter dimming is a container rule with an exemption for the matched set,
// rather than an opacity on each non-match. React Flow diffs elements by object
// identity, so dressing the ~500 non-matches would hand it a new object for
// every one of them on each drag frame; the matched set is normally a handful.
const FILTERING_CLASS = 'op-graph-filtering';
const MATCHED_NODE_CLASS = 'op-graph-node-match';
const MATCHED_EDGE_CLASS = 'op-graph-edge-match';

const NODE_CLASS_BY_RELATION: Record<NodeRelation, string> = {
    [NodeRelation.Input]: 'op-graph-node-input',
    [NodeRelation.Output]: 'op-graph-node-output',
};

const EDGE_CLASS_BY_RELATION: Record<NodeRelation, string> = {
    [NodeRelation.Input]: 'op-graph-edge-input',
    [NodeRelation.Output]: 'op-graph-edge-output',
};

interface OperationGraphReactFlowProps {
    operationList: OperationDescription[];
    operationId?: number;
    perfRows?: PerfOverlaySource[];
    isPerfReportLoaded?: boolean;
}

interface PerfHover {
    operationId: number;
    x: number;
    y: number;
}

interface StyledNodeCacheEntry {
    className: string | undefined;
    perfStyle: CSSProperties | undefined;
    styled: OpGraphFlowNode;
}

const OperationGraphInner = ({
    operationList,
    operationId,
    perfRows,
    isPerfReportLoaded = false,
}: OperationGraphReactFlowProps) => {
    const [nodes, setNodes, onNodesChange] = useNodesState<OpGraphFlowNode>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<OpGraphFlowEdge>([]);
    const [selectedOperationId, setSelectedOperationId] = useState<number | null>(operationId ?? null);
    const [nodeIndex, setNodeIndex] = useState<OpGraphNodeIndexEntry[]>([]);
    const [hideDeallocate, setHideDeallocate] = useState(true);
    const [isPerfOverlayEnabled, setIsPerfOverlayEnabled] = useState(false);
    const [perfHover, setPerfHover] = useState<PerfHover | null>(null);
    const [filterQuery, setFilterQuery] = useState('');
    const [appliedFilterQuery, setAppliedFilterQuery] = useState('');
    const [filterMode, setFilterMode] = useState<GraphFilterMode>(() => {
        const stored = sessionStorage.getItem(FILTER_MODE_STORAGE_KEY);
        return stored === GraphFilterMode.REGEX ? GraphFilterMode.REGEX : GraphFilterMode.SUBSTRING;
    });
    const [currentMatchIndex, setCurrentMatchIndex] = useState<number | null>(null);
    // Navigating between `/graphtree/:operationId` URLs keeps this component
    // mounted, so the incoming id has to be adopted rather than only seeding the
    // initial state. Adjusting during render instead of in an effect avoids a
    // pass where the panel still describes the operation we just left.
    const [adoptedOperationId, setAdoptedOperationId] = useState(operationId);
    if (operationId !== adoptedOperationId) {
        setAdoptedOperationId(operationId);
        if (operationId !== undefined) {
            setSelectedOperationId(operationId);
        }
    }
    const filterRef = useRef<GraphOpFilterHandle>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const containerBoundsRef = useRef<DOMRect | null>(null);
    // A singleton for the component's lifetime rather than a ref, since the
    // styling pass reads it during render and never replaces it.
    const [styledNodeCache] = useState(() => new WeakMap<OpGraphFlowNode, StyledNodeCacheEntry>());
    const { setCenter, getNode } = useReactFlow<OpGraphFlowNode, OpGraphFlowEdge>();
    const flowStore = useStoreApi();

    // Path, not the `ReportFolder` object: a rebuilt-but-equivalent object would
    // otherwise read as a report swap. Matches the report-scoped query keys.
    const profilerReportPath = useAtomValue(activeProfilerReportAtom)?.path ?? null;
    const performanceReportPath = useAtomValue(activePerformanceReportAtom)?.path ?? null;

    // Intent is scoped to the report it was enabled for — another report has a
    // different ramp and linked set. Adjusted during render like
    // `adoptedOperationId` above; an effect would commit one frame still
    // encoding the old ramp. #1880
    const [overlayReportScope, setOverlayReportScope] = useState({
        profiler: profilerReportPath,
        performance: performanceReportPath,
    });
    if (
        overlayReportScope.profiler !== profilerReportPath ||
        overlayReportScope.performance !== performanceReportPath
    ) {
        setOverlayReportScope({ profiler: profilerReportPath, performance: performanceReportPath });
        setIsPerfOverlayEnabled(false);
        setPerfHover(null);
    }

    const selectedOperationIdRef = useRef(selectedOperationId);
    useEffect(() => {
        selectedOperationIdRef.current = selectedOperationId;
    }, [selectedOperationId]);

    // `getNode` reads the React Flow store, a tick behind `setNodes`, so a focus
    // requested mid-build has to wait for the commit.
    const pendingFocusRef = useRef<number | null>(null);

    const sourceOperations = useMemo<OpGraphSourceOperation[]>(
        () =>
            operationList.map((operation) => ({
                id: operation.id,
                name: operation.name,
                fileIdentifier: operation.operationFileIdentifier,
                outputs: operation.outputs.map((tensor) => ({
                    edgeLabel: toReadableShape(tensor.shape),
                    consumers: tensor.consumers,
                })),
            })),
        [operationList],
    );

    // React Flow reports selection by node id; the panel and the toolbar work in
    // operation ids.
    const operationIdByNodeId = useMemo(() => {
        const idsByNodeId = new Map<string, number>();
        for (const entry of nodeIndex) {
            idsByNodeId.set(entry.id, entry.operationId);
        }
        return idsByNodeId;
    }, [nodeIndex]);

    const operationNamesById = useMemo(() => {
        const namesById = new Map<number, string>();
        for (const operation of operationList) {
            namesById.set(operation.id, operation.name);
        }
        return namesById;
    }, [operationList]);

    const onBuilt = useCallback(
        (graph: OpGraphBuiltGraph) => {
            setNodes(graph.nodes);
            setEdges(graph.edges.map((edge) => ({ ...edge, markerEnd: EDGE_MARKER })));
            setNodeIndex(
                graph.nodes.map((node) => ({
                    id: node.id,
                    operationId: node.data.operationId,
                    name: node.data.filterString,
                })),
            );

            // An op can drop out between builds (isolated, or filtered as a
            // deallocate), so selection falls back rather than point at nothing.
            const desired = selectedOperationIdRef.current;
            const isPresent = desired !== null && graph.nodes.some((node) => node.data.operationId === desired);
            const target = isPresent ? desired : (graph.nodes[0]?.data.operationId ?? null);
            if (target !== desired) {
                setSelectedOperationId(target);
            }
            pendingFocusRef.current = target;
        },
        [setNodes, setEdges],
    );

    const { runBuild, isBuilding } = useOpGraphLayoutWorker(sourceOperations, onBuilt);

    // The only input that changes the node set or the layout geometry, and so the
    // only one that may trigger a rebuild.
    const buildOptions = useMemo<OpGraphBuildOptions>(() => ({ hideDeallocate }), [hideDeallocate]);

    // `sourceOperations` isn't read here — it's the signal that the worker holds a
    // new report and the current build is stale.
    useEffect(() => {
        runBuild(buildOptions);
    }, [runBuild, sourceOperations, buildOptions]);

    const focusOperation = useCallback(
        (id: number) => {
            const node = getNode(String(id));
            if (!node) {
                return;
            }
            void setCenter(node.position.x + (node.width ?? 0) / 2, node.position.y + (node.height ?? 0) / 2, {
                zoom: FOCUS_ZOOM,
                duration: FOCUS_DURATION_MS,
            });
        },
        [getNode, setCenter],
    );

    useEffect(() => {
        const target = pendingFocusRef.current;
        if (target === null || nodes.length === 0) {
            return;
        }
        pendingFocusRef.current = null;
        focusOperation(target);
    }, [nodes, focusOperation]);

    // Recentre on the operation the URL names. A no-op on first mount, where the
    // graph hasn't been laid out yet and `onBuilt`'s pending focus does the work.
    useEffect(() => {
        if (operationId !== undefined) {
            focusOperation(operationId);
        }
    }, [operationId, focusOperation]);

    const selectOperation = useCallback(
        (id: number) => {
            setSelectedOperationId(id);
            focusOperation(id);
        },
        [focusOperation],
    );

    // Pressing Enter or Space on a focused node reaches React Flow's own handler,
    // which emits a select change and never calls `onNodeClick` — so a keyboard
    // user could move the selection ring without the panel, the highlight or the
    // prev/next cursor following. Reading selection here instead covers the
    // keyboard, the pointer and Escape through one path.
    const handleNodesChange = useCallback(
        (changes: NodeChange<OpGraphFlowNode>[]) => {
            let hasSelectChange = false;
            let selectedNodeId: string | null = null;
            for (const change of changes) {
                if (change.type === 'select') {
                    hasSelectChange = true;
                    if (change.selected) {
                        selectedNodeId = change.id;
                    }
                }
            }
            // A drag emits position changes only, so the common case forwards the
            // array it was handed rather than rebuilding it.
            if (!hasSelectChange) {
                onNodesChange(changes);
                return;
            }
            // Select changes are read and dropped rather than applied, leaving
            // `selectedOperationId` as the single answer to what is selected.
            const remainingChanges = changes.filter((change) => change.type !== 'select');
            if (remainingChanges.length > 0) {
                onNodesChange(remainingChanges);
            }
            if (selectedNodeId === null) {
                setSelectedOperationId(null);
                return;
            }
            const selectedId = operationIdByNodeId.get(selectedNodeId);
            // Pointer selection arrives here on mousedown and again as a click, and
            // re-running it would restart the centring tween mid-flight.
            if (selectedId !== undefined && selectedId !== selectedOperationIdRef.current) {
                selectOperation(selectedId);
            }
        },
        [onNodesChange, operationIdByNodeId, selectOperation],
    );

    // Clearing applies straight away so Escape and the clear button feel instant;
    // typed queries go through the debounce effect below.
    const handleQueryChange = useCallback((next: string) => {
        setFilterQuery(next);
        setCurrentMatchIndex(null);
        if (next === '') {
            setAppliedFilterQuery('');
        }
    }, []);

    // The same query matches a different set in the other mode, so the cursor
    // can't carry over.
    const handleModeChange = useCallback((next: GraphFilterMode) => {
        setFilterMode(next);
        setCurrentMatchIndex(null);
        sessionStorage.setItem(FILTER_MODE_STORAGE_KEY, next);
    }, []);

    useEffect(() => {
        if (filterQuery === '') {
            return undefined;
        }
        const timeoutId = window.setTimeout(() => setAppliedFilterQuery(filterQuery), FILTER_DEBOUNCE_MS);
        return () => window.clearTimeout(timeoutId);
    }, [filterQuery]);

    // Cmd/Ctrl+F focuses the filter while the graph is mounted; the native
    // find-in-page comes back as soon as the user navigates away.
    useEffect(() => {
        const handleFindShortcut = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.key !== 'f' || event.shiftKey || event.altKey) {
                return;
            }
            event.preventDefault();
            filterRef.current?.focus();
        };
        window.addEventListener('keydown', handleFindShortcut);
        return () => {
            window.removeEventListener('keydown', handleFindShortcut);
        };
    }, []);

    const filterMatcher = useMemo(
        () => (appliedFilterQuery === '' ? null : buildGraphFilterMatcher(filterMode, appliedFilterQuery)),
        [filterMode, appliedFilterQuery],
    );

    const matches = useMemo<OpGraphMatches>(() => {
        if (!filterMatcher) {
            return EMPTY_MATCHES;
        }
        const ids = new Set<string>();
        const operationIdsInOrder: number[] = [];
        for (const entry of nodeIndex) {
            if (filterMatcher.test(entry.name)) {
                ids.add(entry.id);
                operationIdsInOrder.push(entry.operationId);
            }
        }
        return { ids, operationIdsInOrder };
    }, [nodeIndex, filterMatcher]);

    // A query that matches nothing leaves the canvas alone rather than dimming
    // every node to 18%, which reads as a rendering fault.
    const matchedIds = matches.ids.size > 0 ? matches.ids : null;

    const { previousOperationId, nextOperationId } = useMemo(() => {
        const position = nodeIndex.findIndex((entry) => entry.operationId === selectedOperationId);
        if (position === -1) {
            return { previousOperationId: null, nextOperationId: nodeIndex[0]?.operationId ?? null };
        }
        return {
            previousOperationId: nodeIndex[position - 1]?.operationId ?? null,
            nextOperationId: nodeIndex[position + 1]?.operationId ?? null,
        };
    }, [nodeIndex, selectedOperationId]);

    // Stepping matches only moves the viewport. Selection is the user's anchor —
    // and the reason a node stays lit while everything around it fades — so a
    // search walk shouldn't reassign it.
    const goToMatch = useCallback(
        (offset: number) => {
            const total = matches.operationIdsInOrder.length;
            if (total === 0) {
                return;
            }
            let nextIndex: number;
            if (currentMatchIndex === null) {
                nextIndex = offset > 0 ? 0 : total - 1;
            } else {
                nextIndex = (currentMatchIndex + offset + total) % total;
            }
            focusOperation(matches.operationIdsInOrder[nextIndex]);
            setCurrentMatchIndex(nextIndex);
        },
        [matches, currentMatchIndex, focusOperation],
    );

    const goToPreviousMatch = useCallback(() => goToMatch(-1), [goToMatch]);
    const goToNextMatch = useCallback(() => goToMatch(1), [goToMatch]);

    const { edgesBySource, edgesByTarget } = useMemo(() => {
        const bySource = new Map<string, OpGraphFlowEdge[]>();
        const byTarget = new Map<string, OpGraphFlowEdge[]>();
        for (const edge of edges) {
            const outgoing = bySource.get(edge.source);
            if (outgoing) {
                outgoing.push(edge);
            } else {
                bySource.set(edge.source, [edge]);
            }
            const incoming = byTarget.get(edge.target);
            if (incoming) {
                incoming.push(edge);
            } else {
                byTarget.set(edge.target, [edge]);
            }
        }
        return { edgesBySource: bySource, edgesByTarget: byTarget };
    }, [edges]);

    const highlight = useMemo(() => {
        if (selectedOperationId === null) {
            return null;
        }
        const selectedId = String(selectedOperationId);
        const relationByNodeId = new Map<string, NodeRelation>();
        const relationByEdgeId = new Map<string, NodeRelation>();
        // Outputs first: a neighbour on both sides of a cycle reads as an input,
        // matching vis's precedence.
        for (const edge of edgesBySource.get(selectedId) ?? []) {
            relationByNodeId.set(edge.target, NodeRelation.Output);
            relationByEdgeId.set(edge.id, NodeRelation.Output);
        }
        for (const edge of edgesByTarget.get(selectedId) ?? []) {
            relationByNodeId.set(edge.source, NodeRelation.Input);
            relationByEdgeId.set(edge.id, NodeRelation.Input);
        }
        return { selectedId, relationByNodeId, relationByEdgeId };
    }, [selectedOperationId, edgesBySource, edgesByTarget]);

    const graphOperationIds = useMemo(() => nodeIndex.map((entry) => entry.operationId), [nodeIndex]);

    const perfOverlay = useMemo(
        () => buildOpGraphPerfOverlay(perfRows, isPerfReportLoaded, graphOperationIds),
        [perfRows, isPerfReportLoaded, graphOperationIds],
    );

    // Derived, so perf data arriving or going away can't leave a stored flag
    // disagreeing with what the encoding can show.
    const isPerfOverlayActive = isPerfOverlayEnabled && perfOverlay.status === PerfOverlayStatus.READY;

    // Zoom goes straight to the DOM: it changes every wheel frame, and through
    // state it would re-render the whole graph per frame to move one bar.
    // `OpGraphEdge` can afford `useStore` only because it selects a boolean.
    useEffect(() => {
        const container = containerRef.current;
        if (container === null || !isPerfOverlayActive) {
            return undefined;
        }
        let lastZoom: number | null = null;
        const writeZoom = (zoom: number) => {
            const quantised = getQuantisedPerfZoom(zoom);
            if (quantised !== lastZoom) {
                lastZoom = quantised;
                container.style.setProperty(PERF_BAR_ZOOM_VAR, String(quantised));
            }
        };
        writeZoom(flowStore.getState().transform[2]);
        // No selector support in the vanilla store, so every change calls back
        // and the guard above keeps it to one write per zoom bucket.
        return flowStore.subscribe((state) => writeZoom(state.transform[2]));
    }, [isPerfOverlayActive, flowStore]);

    // Built once per score change so the styling pass reuses these identities
    // instead of allocating one per node on every drag frame.
    const perfStyleByNodeId = useMemo(
        () => buildPerfNodeStyleByNodeId(perfOverlay, isPerfOverlayActive),
        [isPerfOverlayActive, perfOverlay],
    );

    const styledNodes = useMemo(() => {
        if (!highlight && !matchedIds && !perfStyleByNodeId) {
            return nodes;
        }
        return nodes.map((node) => {
            const isSelected = node.id === highlight?.selectedId;
            const classNames: string[] = [];
            if (isSelected) {
                classNames.push(SELECTED_NODE_CLASS);
            } else if (highlight) {
                const relation = highlight.relationByNodeId.get(node.id);
                if (relation) {
                    classNames.push(NODE_CLASS_BY_RELATION[relation]);
                }
            }
            // Selection outranks the filter: the anchor stays lit even while a
            // search dims everything around it.
            if (matchedIds && (isSelected || matchedIds.has(node.id))) {
                classNames.push(MATCHED_NODE_CLASS);
            }
            const className = classNames.length > 0 ? classNames.join(' ') : undefined;
            // Custom properties only, so perf stacks with selection, the
            // highlight and the inherited filter dim instead of displacing any.
            const perfStyle = perfStyleByNodeId?.get(node.id);
            if (className === undefined && perfStyle === undefined) {
                return node;
            }

            // A drag frame hands back a new array with one new node object, so a
            // node dressed again here would lose the identity React Flow diffs
            // on. Both inputs are stable — the patches are rebuilt only when the
            // scores change — so an untouched node hits the cache and keeps the
            // object it was given.
            const cached = styledNodeCache.get(node);
            if (cached !== undefined && cached.className === className && cached.perfStyle === perfStyle) {
                return cached.styled;
            }

            const styled = {
                ...node,
                ...(perfStyle ? { style: { ...node.style, ...perfStyle } } : {}),
                ...(className === undefined ? {} : { className }),
                // Selection is mirrored into React Flow's own flag so its keyboard
                // handler reads the same selection the app holds: Escape on the
                // selected node has to register as an unselect, and Enter on it as
                // a no-op. Nothing else ever sets `selected`, since select changes
                // are dropped.
                ...(isSelected ? { selected: true } : {}),
            };
            styledNodeCache.set(node, { className, perfStyle, styled });
            return styled;
        });
    }, [nodes, highlight, matchedIds, perfStyleByNodeId, styledNodeCache]);

    const styledEdges = useMemo(() => {
        if (!highlight && !matchedIds) {
            return edges;
        }
        return edges.map((edge) => {
            const relation = highlight?.relationByEdgeId.get(edge.id);
            const classNames: string[] = [];
            if (relation) {
                classNames.push(EDGE_CLASS_BY_RELATION[relation]);
            }
            // An edge between two matches stays lit so the matched subset is
            // traceable; a selection edge outranks the filter either way.
            if (matchedIds && (relation || (matchedIds.has(edge.source) && matchedIds.has(edge.target)))) {
                classNames.push(MATCHED_EDGE_CLASS);
            }
            return classNames.length > 0 ? { ...edge, className: classNames.join(' ') } : edge;
        });
    }, [edges, highlight, matchedIds]);

    const handleNodeClick = useCallback(
        (_event: ReactMouseEvent, node: OpGraphFlowNode) => {
            selectOperation(node.data.operationId);
        },
        [selectOperation],
    );

    const handlePaneClick = useCallback(() => {
        setSelectedOperationId(null);
    }, []);

    // Cached rather than read per enter: sweeping a dense graph crosses node
    // boundaries many times a second, each fire follows a commit that moved the
    // tooltip, so the read flushes layout for the whole graph DOM — the one cost
    // that scales with node count. The box only moves on resize, scroll, and
    // panel open/close, the last of which resizes the container. #1880
    useEffect(() => {
        const container = containerRef.current;
        if (container === null || !isPerfOverlayActive) {
            return undefined;
        }
        const readBounds = () => {
            containerBoundsRef.current = container.getBoundingClientRect();
        };
        readBounds();
        window.addEventListener('resize', readBounds);
        // Capture: an ancestor scrolling moves the box without scrolling the window.
        window.addEventListener('scroll', readBounds, true);
        // Matches `ChipCongestionCanvas`: jsdom and older browsers without it keep
        // the box read above, refreshed by the two listeners.
        // eslint-disable-next-line compat/compat
        const observer = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(readBounds) : null;
        observer?.observe(container);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', readBounds);
            window.removeEventListener('scroll', readBounds, true);
            containerBoundsRef.current = null;
        };
    }, [isPerfOverlayActive]);

    const handleNodeMouseEnter = useCallback((event: ReactMouseEvent, node: OpGraphFlowNode) => {
        const bounds = containerBoundsRef.current ?? containerRef.current?.getBoundingClientRect();
        if (!bounds) {
            return;
        }
        setPerfHover({
            operationId: node.data.operationId,
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top,
        });
    }, []);

    const handleNodeMouseLeave = useCallback(() => setPerfHover(null), []);

    // Switching off mid-hover would otherwise strand a hover that came back, at
    // a stale position, the next time the overlay was switched on.
    const handlePerfOverlayChange = useCallback((next: boolean) => {
        setIsPerfOverlayEnabled(next);
        setPerfHover(null);
    }, []);

    const perfHoverLabel = useMemo(
        () =>
            isPerfOverlayActive && perfHover !== null ? getPerfHoverLabel(perfOverlay, perfHover.operationId) : null,
        [isPerfOverlayActive, perfHover, perfOverlay],
    );

    const selectedPerfAggregate =
        selectedOperationId === null ? undefined : perfOverlay.aggregatesByOpId.get(selectedOperationId);
    const selectedPerfScore =
        selectedOperationId === null ? undefined : perfOverlay.scoreByOpId.get(selectedOperationId);

    // Closed mid-build so the panel can't describe an operation the graph being
    // laid out is about to drop.
    const isPanelOpen = selectedOperationId !== null && !isBuilding;

    return (
        <div
            className={matchedIds ? `operation-graph-react-flow ${FILTERING_CLASS}` : 'operation-graph-react-flow'}
            ref={containerRef}
        >
            {isBuilding ? (
                <div className='operation-graph-react-flow-loader'>
                    <LoadingSpinner />
                </div>
            ) : null}
            <OpGraphToolbar
                filterRef={filterRef}
                query={filterQuery}
                onQueryChange={handleQueryChange}
                mode={filterMode}
                onModeChange={handleModeChange}
                isRegexInvalid={filterMatcher?.isRegexInvalid ?? false}
                matchCount={matches.operationIdsInOrder.length}
                currentMatchIndex={currentMatchIndex}
                onPrevMatch={goToPreviousMatch}
                onNextMatch={goToNextMatch}
                selectedOperationId={selectedOperationId}
                previousOperationId={previousOperationId}
                nextOperationId={nextOperationId}
                onGoToOperation={selectOperation}
                hideDeallocate={hideDeallocate}
                onHideDeallocateChange={setHideDeallocate}
                isPerfOverlayActive={isPerfOverlayActive}
                onPerfOverlayChange={handlePerfOverlayChange}
                perfOverlayStatus={perfOverlay.status}
                linkedOpCount={perfOverlay.linkedOpCount}
                totalOpCount={perfOverlay.totalOpCount}
                isDisabled={isBuilding}
            />
            <ReactFlow<OpGraphFlowNode, OpGraphFlowEdge>
                nodes={styledNodes}
                edges={styledEdges}
                nodeTypes={NODE_TYPES}
                edgeTypes={EDGE_TYPES}
                onNodesChange={handleNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={handleNodeClick}
                onPaneClick={handlePaneClick}
                onNodeMouseEnter={isPerfOverlayActive ? handleNodeMouseEnter : undefined}
                // Always attached so any exit clears a hover the overlay left
                // behind; clearing a null hover bails out of the render.
                onNodeMouseLeave={handleNodeMouseLeave}
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
                nodesConnectable={false}
                selectNodesOnDrag={false}
                // The graph is a read-only view of a report, but React Flow's
                // stock delete key still reaches `onNodesChange`, so a selected
                // node can be removed until the next relayout puts it back.
                deleteKeyCode={null}
                proOptions={{ hideAttribution: true }}
            >
                <Background />
                <Controls />
                {/* Docked left rather than in React Flow's default corner: the
                    panel is a full-height right column, and `onBuilt` always
                    resolves a selection, so a right-docked minimap would be
                    hidden in every state the user lands in. */}
                <MiniMap
                    pannable
                    position='bottom-left'
                />
            </ReactFlow>
            {isPerfOverlayActive && !isBuilding ? (
                <div className='op-graph-perf-legend'>
                    <PerfOverlayLegend
                        minNs={perfOverlay.minNs}
                        maxNs={perfOverlay.maxNs}
                    />
                </div>
            ) : null}
            {perfHoverLabel !== null && perfHover !== null ? (
                // Pointer-only, and `role='tooltip'` would promise a relationship no
                // `aria-describedby` provides. The panel's Kernel duration row carries
                // the same figure and is reachable by keyboard, so this stays decorative
                // rather than advertising a path assistive tech cannot follow. #1880
                <div
                    className='op-graph-perf-hover'
                    style={{ left: perfHover.x, top: perfHover.y }}
                    aria-hidden='true'
                >
                    {perfHoverLabel}
                </div>
            ) : null}
            {isPanelOpen ? (
                <OpGraphInfoPanel
                    operationId={selectedOperationId}
                    operationList={operationList}
                    operationNamesById={operationNamesById}
                    onLocateOperation={focusOperation}
                    isPerfOverlayActive={isPerfOverlayActive}
                    perfDeviceTimeNs={selectedPerfAggregate?.deviceTimeNs}
                    perfColor={selectedPerfScore ? perfColorScale(selectedPerfScore.t) : undefined}
                />
            ) : null}
        </div>
    );
};

const OperationGraphReactFlow = (props: OperationGraphReactFlowProps) => (
    <ReactFlowProvider>
        <OperationGraphInner {...props} />
    </ReactFlowProvider>
);

export default memo(OperationGraphReactFlow);
