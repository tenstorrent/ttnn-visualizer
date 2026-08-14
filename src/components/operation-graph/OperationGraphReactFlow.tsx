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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useAtomValue } from 'jotai';
import { type MouseEvent as ReactMouseEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NodeRelation } from '../../definitions/NodeRelation';
import { PerfOverlayStatus } from '../../definitions/PerfOverlayStatus';
import type { ReportFolder } from '../../definitions/Reports';
import { toReadableShape } from '../../functions/formatting';
import type { OperationDescription } from '../../model/APIData';
import {
    type PerfOverlaySource,
    aggregatePerfByOp,
    isDarkPerfColor,
    perfColorScale,
    scoreOps,
} from '../../functions/perfOverlay';
import { activePerformanceReportAtom, activeProfilerReportAtom } from '../../store/app';
import LoadingSpinner from '../LoadingSpinner';
import PerfOverlayLegend from '../perf-overlay/PerfOverlayLegend';
import OpGraphEdge from './OpGraphEdge';
import type { OpGraphFilterHandle } from './OpGraphFilter';
import OpGraphInfoPanel from './OpGraphInfoPanel';
import OpGraphNode from './OpGraphNode';
import OpGraphToolbar from './OpGraphToolbar';
import { OpGraphFilterMode, buildOpGraphFilterMatcher } from './opGraphFilterMatcher';
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
// The two cold bins and the hot-red bin of the ramp are dark enough that the
// node's default near-black label sinks into them.
const PERF_DARK_NODE_CLASS = 'op-graph-node-perf-dark';

// `syncedName` over `path`, per `ReportFolder`: `path` is still the remote path
// while a report is freshly selected, so it changes under a report that hasn't.
const getReportIdentity = (report: ReportFolder | null): string => report?.syncedName ?? report?.path ?? '';

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
    /**
     * Whether *any* perf report is loaded, independent of whether it links up.
     * Separates "load a report" from "the loaded one doesn't match this graph".
     * Omitted by callers that bypass the linking pipeline (tests), which then
     * fall back to a row-count heuristic.
     */
    isPerfReportLoaded?: boolean;
}

const OperationGraphInner = ({
    operationList,
    operationId,
    perfRows,
    isPerfReportLoaded,
}: OperationGraphReactFlowProps) => {
    const [nodes, setNodes, onNodesChange] = useNodesState<OpGraphFlowNode>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<OpGraphFlowEdge>([]);
    const [selectedOperationId, setSelectedOperationId] = useState<number | null>(operationId ?? null);
    const [nodeIndex, setNodeIndex] = useState<OpGraphNodeIndexEntry[]>([]);
    const [hideDeallocate, setHideDeallocate] = useState(true);
    const [isCompact, setIsCompact] = useState(false);
    const [filterQuery, setFilterQuery] = useState('');
    const [appliedFilterQuery, setAppliedFilterQuery] = useState('');
    const [filterMode, setFilterMode] = useState<OpGraphFilterMode>(() => {
        const stored = sessionStorage.getItem(FILTER_MODE_STORAGE_KEY);
        return stored === OpGraphFilterMode.REGEX ? OpGraphFilterMode.REGEX : OpGraphFilterMode.SUBSTRING;
    });
    const [currentMatchIndex, setCurrentMatchIndex] = useState<number | null>(null);
    const [perfOverlayEnabledFor, setPerfOverlayEnabledFor] = useState<string | null>(null);
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
    const { setCenter, getNode } = useReactFlow<OpGraphFlowNode, OpGraphFlowEdge>();

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

    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    // Overlay intent is per-report, not a stored preference: another report has
    // other ops, so carrying the toggle over would colour a graph against
    // numbers the user never asked for. Recording *which* pair it was enabled
    // for makes switching reports turn it off structurally, with no effect
    // chasing the change a render later.
    const perfReportKey = `${getReportIdentity(activeProfilerReport)}|${getReportIdentity(activePerformanceReport)}`;
    const isPerfOverlayEnabled = perfOverlayEnabledFor === perfReportKey;

    const handlePerfOverlayChange = useCallback(
        (next: boolean) => {
            setPerfOverlayEnabledFor(next ? perfReportKey : null);
        },
        [perfReportKey],
    );

    const perfAggregates = useMemo(() => aggregatePerfByOp(perfRows ?? []), [perfRows]);
    const { scoreByOpId, minNs, maxNs } = useMemo(() => scoreOps(perfAggregates), [perfAggregates]);

    const perfOverlayStatus = useMemo<PerfOverlayStatus>(() => {
        const isAvailable = isPerfReportLoaded ?? (perfRows !== undefined && perfRows.length > 0);
        if (!isAvailable) {
            return PerfOverlayStatus.UNAVAILABLE;
        }
        const isLinked = scoreByOpId.size > 0 && operationList.some((operation) => scoreByOpId.has(operation.id));
        return isLinked ? PerfOverlayStatus.READY : PerfOverlayStatus.UNLINKED;
    }, [isPerfReportLoaded, perfRows, scoreByOpId, operationList]);

    const isPerfOverlayActive = isPerfOverlayEnabled && perfOverlayStatus === PerfOverlayStatus.READY;

    const selectedPerfMetric = useMemo(() => {
        if (!isPerfOverlayActive || selectedOperationId === null) {
            return null;
        }
        const score = scoreByOpId.get(selectedOperationId);
        return {
            deviceTimeNs: perfAggregates.get(selectedOperationId)?.deviceTimeNs,
            color: score ? perfColorScale(score.t) : undefined,
        };
    }, [isPerfOverlayActive, selectedOperationId, scoreByOpId, perfAggregates]);

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

    // The only two inputs that change the node set or the layout geometry, and so
    // the only two that may trigger a rebuild.
    const buildOptions = useMemo<OpGraphBuildOptions>(
        () => ({ hideDeallocate, isCompact }),
        [hideDeallocate, isCompact],
    );

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

    const styledNodes = useMemo(() => {
        if (!highlight && !matchedIds && !isPerfOverlayActive) {
            return nodes;
        }
        return nodes.map((node) => {
            const isSelected = node.id === highlight?.selectedId;
            const relation = isSelected ? undefined : highlight?.relationByNodeId.get(node.id);
            const classNames: string[] = [];
            if (isSelected) {
                classNames.push(SELECTED_NODE_CLASS);
            } else if (relation) {
                classNames.push(NODE_CLASS_BY_RELATION[relation]);
            }

            // Relation colours outrank the ramp, as they did under vis: an
            // input/output tint answers "what does the selection touch", which
            // is the question the user asked most recently.
            const score = isPerfOverlayActive && !relation ? scoreByOpId.get(node.data.operationId) : undefined;
            const perfColor = score ? perfColorScale(score.t) : undefined;
            if (perfColor && isDarkPerfColor(perfColor)) {
                classNames.push(PERF_DARK_NODE_CLASS);
            }

            const isDimmed = matchedIds !== null && !isSelected && !matchedIds.has(node.id);
            if (classNames.length === 0 && !perfColor && !isDimmed) {
                return node;
            }
            let styled = node;
            if (classNames.length > 0) {
                styled = { ...styled, className: classNames.join(' ') };
            }
            if (perfColor || isDimmed) {
                styled = {
                    ...styled,
                    style: {
                        ...styled.style,
                        ...(perfColor ? { backgroundColor: perfColor } : {}),
                        ...(isDimmed ? { opacity: FILTER_DIM_OPACITY } : {}),
                    },
                };
            }
            return styled;
        });
    }, [nodes, highlight, matchedIds, isPerfOverlayActive, scoreByOpId]);

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

    // The panel covers the corner the minimap docks in. Unmounting rather than
    // hiding it drops a per-node rect that re-derives on every node change.
    const isPanelOpen = selectedOperationId !== null && !isBuilding;

    return (
        <div className='operation-graph-react-flow'>
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
                isCompact={isCompact}
                onCompactChange={setIsCompact}
                isPerfOverlayActive={isPerfOverlayActive}
                onPerfOverlayChange={handlePerfOverlayChange}
                perfOverlayStatus={perfOverlayStatus}
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
                <PerfOverlayLegend
                    minNs={minNs}
                    maxNs={maxNs}
                />
            ) : null}
            {isPanelOpen ? (
                <OpGraphInfoPanel
                    operationId={selectedOperationId}
                    operationList={operationList}
                    operationNamesById={operationNamesById}
                    onLocateOperation={focusOperation}
                    perfDeviceTimeNs={selectedPerfMetric?.deviceTimeNs}
                    perfColor={selectedPerfMetric?.color}
                    isPerfOverlayActive={isPerfOverlayActive}
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
