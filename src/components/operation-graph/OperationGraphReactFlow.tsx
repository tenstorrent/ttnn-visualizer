// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
    Background,
    Controls,
    MarkerType,
    MiniMap,
    ReactFlow,
    ReactFlowProvider,
    useEdgesState,
    useNodesState,
    useReactFlow,
    useStoreApi,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useAtomValue } from 'jotai';
import { type MouseEvent as ReactMouseEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NodeRelation } from '../../definitions/NodeRelation';
import { PerfOverlayStatus } from '../../definitions/PerfOverlayStatus';
import { toReadableShape } from '../../functions/formatting';
import type { OperationDescription } from '../../model/APIData';
import { type PerfOverlaySource, perfColorScale } from '../../functions/perfOverlay';
import { activePerformanceReportAtom, activeProfilerReportAtom } from '../../store/app';
import LoadingSpinner from '../LoadingSpinner';
import PerfOverlayLegend from '../perf-overlay/PerfOverlayLegend';
import OpGraphEdge from './OpGraphEdge';
import type { OpGraphFilterHandle } from './OpGraphFilter';
import OpGraphInfoPanel from './OpGraphInfoPanel';
import OpGraphNode from './OpGraphNode';
import OpGraphToolbar from './OpGraphToolbar';
import { OpGraphFilterMode, buildOpGraphFilterMatcher } from './opGraphFilterMatcher';
import {
    PERF_BAR_ZOOM_VAR,
    buildOpGraphPerfOverlay,
    buildPerfNodeStyleByNodeId,
    getPerfHoverLabel,
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

// Non-matches fade instead of hiding, so the matched subset keeps its position
// in the layout rather than the graph reflowing under the user mid-search.
const FILTER_DIM_OPACITY = 0.18;
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
    const [filterMode, setFilterMode] = useState<OpGraphFilterMode>(() => {
        const stored = sessionStorage.getItem(FILTER_MODE_STORAGE_KEY);
        return stored === OpGraphFilterMode.REGEX ? OpGraphFilterMode.REGEX : OpGraphFilterMode.SUBSTRING;
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
    const filterRef = useRef<OpGraphFilterHandle>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { setCenter, getNode } = useReactFlow<OpGraphFlowNode, OpGraphFlowEdge>();
    const flowStore = useStoreApi();

    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    // Overlay intent is scoped to the report it was enabled for: another report
    // has a different ramp and a different linked set, so carrying the toggle
    // across would re-anchor the encoding under the user. Dropping it also stops
    // a report that leaves and re-enters `READY` from switching the overlay back
    // on by itself. Adjusted during render like `adoptedOperationId` above,
    // because an effect would commit one frame still encoding the old ramp. #1880
    const [overlayReportScope, setOverlayReportScope] = useState({
        profiler: activeProfilerReport,
        performance: activePerformanceReport,
    });
    if (
        overlayReportScope.profiler !== activeProfilerReport ||
        overlayReportScope.performance !== activePerformanceReport
    ) {
        setOverlayReportScope({ profiler: activeProfilerReport, performance: activePerformanceReport });
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
    const handleModeChange = useCallback((next: OpGraphFilterMode) => {
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
        () => (appliedFilterQuery === '' ? null : buildOpGraphFilterMatcher(filterMode, appliedFilterQuery)),
        [filterMode, appliedFilterQuery],
    );

    const matches = useMemo<OpGraphMatches>(() => {
        if (!filterMatcher) {
            return EMPTY_MATCHES;
        }
        const ids = new Set<string>();
        const operationIdsInOrder: number[] = [];
        for (const entry of nodeIndex) {
            if (filterMatcher.testName(entry.name)) {
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

    // Derived rather than stored, so perf data arriving or going away can't leave
    // a stored flag disagreeing with what the encoding can actually show. The
    // report-scope reset above is what keeps intent itself from outliving its
    // report — the two cover different failures and both are needed.
    const isPerfOverlayActive = isPerfOverlayEnabled && perfOverlay.status === PerfOverlayStatus.READY;

    // Zoom is written straight to the DOM instead of through state: it changes on
    // every wheel and pinch frame, and routing it through React would re-render
    // the whole graph per frame to move one bar. `OpGraphEdge` can afford
    // `useStore` because it selects a threshold boolean; this needs the
    // continuous value, so it subscribes and mutates the custom property.
    useEffect(() => {
        const container = containerRef.current;
        if (container === null || !isPerfOverlayActive) {
            return undefined;
        }
        let lastZoom: number | null = null;
        const writeZoom = (zoom: number) => {
            if (zoom !== lastZoom) {
                lastZoom = zoom;
                container.style.setProperty(PERF_BAR_ZOOM_VAR, String(zoom));
            }
        };
        writeZoom(flowStore.getState().transform[2]);
        // The vanilla store has no selector support, so every store change calls
        // back and the guard above keeps it to one style write per zoom change.
        return flowStore.subscribe((state) => writeZoom(state.transform[2]));
    }, [isPerfOverlayActive, flowStore]);

    // Built once per score change so the styling pass can reuse these object
    // identities rather than allocating one per node on every drag frame.
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
            let styled = node;
            if (isSelected) {
                styled = { ...styled, className: SELECTED_NODE_CLASS };
            } else if (highlight) {
                const relation = highlight.relationByNodeId.get(node.id);
                if (relation) {
                    styled = { ...styled, className: NODE_CLASS_BY_RELATION[relation] };
                }
            }
            // Perf writes only custom properties, so it stacks with selection and
            // the highlight instead of displacing either. An op with no perf row
            // gets nothing here, and its bar stays transparent.
            const perfStyle = perfStyleByNodeId?.get(node.id);
            if (perfStyle) {
                styled = { ...styled, style: { ...styled.style, ...perfStyle } };
            }
            if (matchedIds && !isSelected && !matchedIds.has(node.id)) {
                // Opacity on the node multiplies its bar, so a dimmed non-match
                // dims its perf signal with it.
                styled = { ...styled, style: { ...styled.style, opacity: FILTER_DIM_OPACITY } };
            }
            return styled;
        });
    }, [nodes, highlight, matchedIds, perfStyleByNodeId]);

    const styledEdges = useMemo(() => {
        if (!highlight && !matchedIds) {
            return edges;
        }
        return edges.map((edge) => {
            const relation = highlight?.relationByEdgeId.get(edge.id);
            let styled = relation ? { ...edge, className: EDGE_CLASS_BY_RELATION[relation] } : edge;
            // An edge between two matches stays lit so the matched subset is
            // traceable; a selection edge outranks the filter either way.
            if (matchedIds && !relation && !(matchedIds.has(edge.source) && matchedIds.has(edge.target))) {
                styled = { ...styled, style: { ...styled.style, opacity: FILTER_DIM_OPACITY } };
            }
            return styled;
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

    // Reading the container box on enter rather than per mousemove: the pointer
    // crosses a node boundary orders of magnitude less often than it moves.
    const handleNodeMouseEnter = useCallback((event: ReactMouseEvent, node: OpGraphFlowNode) => {
        const bounds = containerRef.current?.getBoundingClientRect();
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

    // Dropping the hover here rather than reacting to the overlay going quiet:
    // switching off mid-hover would otherwise strand an open hover that came
    // back, at a stale position, the next time the overlay was switched on.
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

    // The panel covers the corner the minimap docks in. Unmounting rather than
    // hiding it drops a per-node rect that re-derives on every node change.
    const isPanelOpen = selectedOperationId !== null && !isBuilding;

    return (
        <div
            className='operation-graph-react-flow'
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
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={handleNodeClick}
                onPaneClick={handlePaneClick}
                onNodeMouseEnter={isPerfOverlayActive ? handleNodeMouseEnter : undefined}
                // Always attached, so any pointer exit clears a hover the
                // overlay left behind. Clearing an already-null hover bails out
                // of the render, so this costs nothing while the overlay is off.
                onNodeMouseLeave={handleNodeMouseLeave}
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
                nodesConnectable={false}
                selectNodesOnDrag={false}
                proOptions={{ hideAttribution: true }}
            >
                <Background />
                <Controls />
                {!isPanelOpen ? <MiniMap pannable /> : null}
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
                <div
                    className='op-graph-perf-hover'
                    style={{ left: perfHover.x, top: perfHover.y }}
                    role='tooltip'
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
