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
import { useAtom, useAtomValue } from 'jotai';
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
import { type ReportScope, isSameReportScope } from '../../definitions/ReportScope';
import { activePerformanceReportAtom, activeProfilerReportAtom, criticalPathScopeAtom } from '../../store/app';
import type { GraphOpFilterHandle } from '../GraphOpFilter';
import LoadingSpinner from '../LoadingSpinner';
import PerfOverlayLegend from '../perf-overlay/PerfOverlayLegend';
import CriticalPathAnnotation from './CriticalPathAnnotation';
import OpGraphBlockNode from './OpGraphBlockNode';
import OpGraphDeviceGroupNode from './OpGraphDeviceGroupNode';
import OpGraphDeviceOpNode from './OpGraphDeviceOpNode';
import OpGraphEdge from './OpGraphEdge';
import OpGraphInfoPanel from './OpGraphInfoPanel';
import OpGraphNode from './OpGraphNode';
import OpGraphToolbar from './OpGraphToolbar';
import { buildDeviceOperationSubgraph, countDeviceOperations } from './opGraphDeviceSubgraph';
import { OpGraphBlockExpansionContext, OpGraphExpansionContext } from './opGraphExpansionContext';
import {
    PERF_BAR_ZOOM_VAR,
    buildOpGraphPerfOverlay,
    buildPerfNodeStyleByNodeId,
    getPerfHoverLabel,
    getQuantisedPerfZoom,
} from './opGraphPerfOverlay';
import { EMPTY_CRITICAL_PATH, findCriticalPath } from './opGraphCriticalPath';
import { useOpGraphLayoutWorker } from './useOpGraphLayoutWorker';
import {
    type OpGraphBlockSummary,
    type OpGraphBuildOptions,
    type OpGraphBuiltGraph,
    type OpGraphDeviceSubgraph,
    OpGraphEdgeType,
    type OpGraphFlowEdge,
    type OpGraphFlowNode,
    type OpGraphNodeIndexEntry,
    OpGraphNodeType,
    type OpGraphSourceOperation,
} from './opGraphTypes';
import 'styles/components/OperationGraphReactFlow.scss';

const NODE_TYPES = {
    [OpGraphNodeType.OP]: OpGraphNode,
    [OpGraphNodeType.DEVICE_GROUP]: OpGraphDeviceGroupNode,
    [OpGraphNodeType.DEVICE_OP]: OpGraphDeviceOpNode,
    [OpGraphNodeType.BLOCK]: OpGraphBlockNode,
};
const EDGE_TYPES = { [OpGraphEdgeType.OP]: OpGraphEdge };

const EDGE_MARKER = { type: MarkerType.ArrowClosed, width: 18, height: 18 } as const;

const sourceOperationIdOf = (edge: OpGraphFlowEdge): number | undefined => edge.data?.sourceOperationId;
const targetOperationIdOf = (edge: OpGraphFlowEdge): number | undefined => edge.data?.targetOperationId;

const isInternalDeviceEdge = (edge: OpGraphFlowEdge): boolean =>
    sourceOperationIdOf(edge) === targetOperationIdOf(edge);

const operationNodeIdOf = (
    operationId: number | undefined,
    nodeIdByOperationId: ReadonlyMap<number, string>,
): string | null => {
    if (operationId === undefined) {
        return null;
    }
    return nodeIdByOperationId.get(operationId) ?? String(operationId);
};

const operationBoundaryOf = (
    edge: OpGraphFlowEdge,
    nodeIdByOperationId: ReadonlyMap<number, string>,
): { source: string; target: string } | null => {
    if (isInternalDeviceEdge(edge)) {
        return null;
    }
    const source = operationNodeIdOf(sourceOperationIdOf(edge), nodeIdByOperationId);
    const target = operationNodeIdOf(targetOperationIdOf(edge), nodeIdByOperationId);
    if (source === null || target === null) {
        return null;
    }
    return { source, target };
};

const bothEndsMatched = (
    edge: OpGraphFlowEdge,
    matchedIds: ReadonlySet<string>,
    nodeIdByOperationId: ReadonlyMap<number, string>,
): boolean => {
    const source = operationNodeIdOf(sourceOperationIdOf(edge), nodeIdByOperationId);
    const target = operationNodeIdOf(targetOperationIdOf(edge), nodeIdByOperationId);
    return source !== null && target !== null && matchedIds.has(source) && matchedIds.has(target);
};

const tensorBytes = (tensors: { size: number | null }[]): number =>
    tensors.reduce((total, tensor) => total + (tensor.size ?? 0), 0);

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
    hiddenMatchCount: number;
    buriedCountById: Map<string, number>;
}

// Shared so an idle filter yields one stable identity instead of a fresh empty
// set per render, which would invalidate every memo downstream.
const EMPTY_MATCHES: OpGraphMatches = {
    ids: new Set<string>(),
    operationIdsInOrder: [],
    hiddenMatchCount: 0,
    buriedCountById: new Map<string, number>(),
};

// Same reason: resetting expansion to a fresh set would rebuild the graph even
// when nothing was expanded to begin with.
const NOTHING_EXPANDED: ReadonlySet<number> = new Set<number>();
const NOTHING_EXPANDED_BLOCKS: ReadonlySet<string> = new Set<string>();
const NO_BLOCKS: OpGraphBlockSummary[] = [];
const NO_DEVICE_SUBGRAPHS: OpGraphDeviceSubgraph[] = [];
const EMPTY_NODE_ID_BY_OP = new Map<number, string>();
const EMPTY_BLOCK_IDS: string[] = [];

const areSameBlockSummaries = (left: OpGraphBlockSummary[], right: OpGraphBlockSummary[]): boolean => {
    if (left === right) {
        return true;
    }
    if (left.length !== right.length) {
        return false;
    }
    return left.every((block, index) => {
        const other = right[index];
        return (
            block.instanceId === other.instanceId &&
            block.label === other.label &&
            block.operationIds.length === other.operationIds.length &&
            block.operationIds.every((id, idIndex) => id === other.operationIds[idIndex])
        );
    });
};

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

// Off-path edges dim from the container for the same identity reason as the
// filter above; only the path itself gets per-element classes. #1613
const CRITICAL_PATH_CLASS = 'op-graph-critical-path';
const CRITICAL_PATH_NODE_CLASS = 'op-graph-node-critical-path';
const CRITICAL_PATH_EDGE_CLASS = 'op-graph-edge-critical-path';
const FOCUS_EDGES_CLASS = 'op-graph-focus-edges';

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
    // The edge set as built, kept apart from React Flow's edge state: that array is
    // replaced by `applyEdgeChanges` on every edge selection, which cannot change
    // the graph's shape. Anything deriving from the graph's topology reads this, so
    // selecting an edge doesn't pay for a traversal. #1613
    const [builtEdges, setBuiltEdges] = useState<OpGraphFlowEdge[]>([]);
    const [hideDeallocate, setHideDeallocate] = useState(true);
    const [focusUnrelatedEdges, setFocusUnrelatedEdges] = useState(false);
    // Local like the perf overlay rather than an atom: expansion describes a
    // reading position in one graph, and the MLIR view scopes its own namespace
    // expansion the same way. #1195
    const [expandedOperationIds, setExpandedOperationIds] = useState<ReadonlySet<number>>(NOTHING_EXPANDED);
    const [expandedBlockIds, setExpandedBlockIds] = useState<ReadonlySet<string>>(NOTHING_EXPANDED_BLOCKS);
    const [detectedBlocks, setDetectedBlocks] = useState<OpGraphBlockSummary[]>(NO_BLOCKS);
    const [nodeIdByOperationId, setNodeIdByOperationId] = useState<ReadonlyMap<number, string>>(EMPTY_NODE_ID_BY_OP);
    const [isPerfOverlayEnabled, setIsPerfOverlayEnabled] = useState(false);
    const [criticalPathScope, setCriticalPathScope] = useAtom(criticalPathScopeAtom);
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
    // Subgraphs are derived on expansion, so a collapse and a second look costs
    // nothing. `null` is a real entry — an operation whose frames produce nothing
    // worth drawing — so misses are distinguished by `undefined`.
    const [deviceSubgraphCache] = useState(() => new Map<number, OpGraphDeviceSubgraph | null>());
    // Expanding grows a node, which moves every node Dagre packs around it. Held
    // from the toggle until the rebuilt graph commits, then spent translating the
    // viewport so the operation stays under the cursor that opened it — otherwise
    // the graph appears to jump and the user loses their place. Scoped to the
    // report it was armed for so a swap cannot spend it against a same-id node.
    const pendingViewportAnchorRef = useRef<{
        nodeId: string;
        fallbackNodeId: string;
        paneX: number;
        paneY: number;
        reportScope: ReportScope;
    } | null>(null);
    const [revealedOperationId, setRevealedOperationId] = useState<number | null>(null);
    const { setCenter, getNode, getViewport, setViewport } = useReactFlow<OpGraphFlowNode, OpGraphFlowEdge>();
    const flowStore = useStoreApi();

    // Path, not the `ReportFolder` object: a rebuilt-but-equivalent object would
    // otherwise read as a report swap. Matches the report-scoped query keys.
    const profilerReportPath = useAtomValue(activeProfilerReportAtom)?.path ?? null;
    const performanceReportPath = useAtomValue(activePerformanceReportAtom)?.path ?? null;

    const reportScope = useMemo<ReportScope>(
        () => ({ profiler: profilerReportPath, performance: performanceReportPath }),
        [profilerReportPath, performanceReportPath],
    );

    // Intent is scoped to the report it was enabled for — another report has a
    // different ramp and linked set. Adjusted during render like
    // `adoptedOperationId` above; an effect would commit one frame still
    // encoding the old ramp. #1880
    const [overlayReportScope, setOverlayReportScope] = useState<ReportScope>(reportScope);
    if (!isSameReportScope(overlayReportScope, reportScope)) {
        setOverlayReportScope(reportScope);
        setIsPerfOverlayEnabled(false);
        setPerfHover(null);
        // Operation ids restart per report, so a surviving expansion would open
        // whichever unrelated operation now answers to that id.
        setExpandedOperationIds(NOTHING_EXPANDED);
        setExpandedBlockIds(NOTHING_EXPANDED_BLOCKS);
        setDetectedBlocks(NO_BLOCKS);
        setNodeIdByOperationId(EMPTY_NODE_ID_BY_OP);
        setRevealedOperationId(null);
        deviceSubgraphCache.clear();
    }

    // The atom carries the scope it was enabled for, so a swap invalidates the
    // intent by not matching it — no stale frame to close, and no render-phase
    // write to a shared atom. #1613
    const isCriticalPathEnabled = criticalPathScope !== null && isSameReportScope(criticalPathScope, reportScope);

    // Forgetting, not resetting: the read above already ignores a scope that
    // doesn't match, so this only stops a return trip from reviving the switch —
    // the overlay's behaviour. Effect timing is unobservable for the same reason.
    useEffect(() => {
        if (criticalPathScope !== null && !isSameReportScope(criticalPathScope, reportScope)) {
            setCriticalPathScope(null);
        }
    }, [criticalPathScope, reportScope, setCriticalPathScope]);

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
                    tensorId: tensor.id,
                })),
                // Counted with the same predicate the subgraph is built from rather
                // than from `deviceOperationNameList`, which the details panel uses
                // and which screens out the `Tensor::` frames the graph draws.
                deviceOperationCount: countDeviceOperations(operation),
                inputShapes: operation.inputs.map((tensor) => toReadableShape(tensor.shape)),
                durationSeconds: operation.duration,
                memoryDeltaBytes: tensorBytes(operation.outputs) - tensorBytes(operation.inputs),
            })),
        [operationList],
    );

    const operationById = useMemo(() => {
        const byId = new Map<number, OperationDescription>();
        for (const operation of operationList) {
            byId.set(operation.id, operation);
        }
        return byId;
    }, [operationList]);

    // Only the expanded operations are assembled: one operation's frame stream
    // runs to thousands of nodes, so deriving all of them up front would pay for
    // the ones nobody opens.
    const collapsedMemberIds = useMemo(() => {
        const memberIds = new Set<number>();
        for (const block of detectedBlocks) {
            if (!expandedBlockIds.has(block.instanceId)) {
                for (const memberOpId of block.operationIds) {
                    memberIds.add(memberOpId);
                }
            }
        }
        return memberIds;
    }, [detectedBlocks, expandedBlockIds]);

    const deviceSubgraphs = useMemo<OpGraphDeviceSubgraph[]>(() => {
        const assembled: OpGraphDeviceSubgraph[] = [];
        for (const expandedOperationId of expandedOperationIds) {
            if (!collapsedMemberIds.has(expandedOperationId)) {
                let subgraph = deviceSubgraphCache.get(expandedOperationId);
                if (subgraph === undefined) {
                    const operation = operationById.get(expandedOperationId);
                    subgraph = operation === undefined ? null : buildDeviceOperationSubgraph(operation);
                    deviceSubgraphCache.set(expandedOperationId, subgraph);
                }
                if (subgraph !== null) {
                    assembled.push(subgraph);
                }
            }
        }
        return assembled.length === 0 ? NO_DEVICE_SUBGRAPHS : assembled;
    }, [expandedOperationIds, collapsedMemberIds, operationById, deviceSubgraphCache]);

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
            const edgesForBuild = graph.edges.map((edge) => ({ ...edge, markerEnd: EDGE_MARKER }));
            setNodes(graph.nodes);
            setEdges(edgesForBuild);
            setBuiltEdges(edgesForBuild);
            // Device operations are deliberately absent: the index is what the perf
            // ramp, the critical path DAG, the filter and prev/next are computed
            // over, and a child has no duration, no name worth matching and no
            // place in the operation sequence. Leaving them out is what keeps them
            // from being scored as zero-cost operations. #1195
            const indexEntries: OpGraphNodeIndexEntry[] = [];
            const renderedByOpId = new Map<number, string>();
            for (const node of graph.nodes) {
                if (node.type !== OpGraphNodeType.DEVICE_OP) {
                    indexEntries.push({
                        id: node.id,
                        operationId: node.data.operationId,
                        name: node.data.filterString,
                        memberNames: node.data.memberNames,
                        memberOperationIds: node.data.memberOperationIds,
                    });
                    if (node.data.memberOperationIds !== undefined) {
                        for (const memberId of node.data.memberOperationIds) {
                            renderedByOpId.set(memberId, node.id);
                        }
                    } else {
                        renderedByOpId.set(node.data.operationId, node.id);
                    }
                }
            }
            setNodeIndex(indexEntries);
            setNodeIdByOperationId(renderedByOpId);
            // A new array with the same detections rebuilds `deviceSubgraphs` and
            // `runBuild` loops; each pass restarts the focus tween toward op 0.
            const nextBlocks = graph.blocks && graph.blocks.length > 0 ? graph.blocks : NO_BLOCKS;
            setDetectedBlocks((previous) => (areSameBlockSummaries(previous, nextBlocks) ? previous : nextBlocks));

            // An op can drop out between builds (isolated, or filtered as a
            // deallocate), so selection falls back rather than point at nothing.
            const desired = selectedOperationIdRef.current;
            const isPresent =
                desired !== null &&
                graph.nodes.some(
                    (node) =>
                        node.data.operationId === desired ||
                        (node.data.memberOperationIds !== undefined && node.data.memberOperationIds.includes(desired)),
                );
            const target = isPresent ? desired : (graph.nodes[0]?.data.operationId ?? null);
            if (target !== desired) {
                setSelectedOperationId(target);
            }
            // An expand or collapse has an anchor waiting, and recentring on the
            // selection would overrule it — the two would fight for the viewport.
            if (pendingViewportAnchorRef.current === null) {
                pendingFocusRef.current = target;
            }
        },
        [setNodes, setEdges],
    );

    const { runBuild, isBuilding } = useOpGraphLayoutWorker(sourceOperations, onBuilt);

    // The only inputs that change the node set or the layout geometry, and so the
    // only ones that may trigger a rebuild.
    const buildOptions = useMemo<OpGraphBuildOptions>(
        () => ({
            hideDeallocate,
            deviceSubgraphs,
            expandedBlockIds: expandedBlockIds.size === 0 ? EMPTY_BLOCK_IDS : [...expandedBlockIds],
        }),
        [hideDeallocate, deviceSubgraphs, expandedBlockIds],
    );

    // `sourceOperations` isn't read here — it's the signal that the worker holds a
    // new report and the current build is stale.
    useEffect(() => {
        runBuild(buildOptions);
    }, [runBuild, sourceOperations, buildOptions]);

    const focusOperation = useCallback(
        (id: number) => {
            const node = getNode(nodeIdByOperationId.get(id) ?? String(id));
            if (!node) {
                return;
            }
            void setCenter(node.position.x + (node.width ?? 0) / 2, node.position.y + (node.height ?? 0) / 2, {
                zoom: FOCUS_ZOOM,
                duration: FOCUS_DURATION_MS,
            });
        },
        [getNode, setCenter, nodeIdByOperationId],
    );

    useEffect(() => {
        const target = pendingFocusRef.current;
        if (target === null || nodes.length === 0) {
            return;
        }
        pendingFocusRef.current = null;
        focusOperation(target);
    }, [nodes, focusOperation]);

    // Read from the committed array rather than `getNode`, which trails `setNodes`
    // by a tick and would translate against the pre-rebuild position.
    useEffect(() => {
        const anchor = pendingViewportAnchorRef.current;
        if (anchor === null) {
            return;
        }
        if (nodes.length === 0 || !isSameReportScope(anchor.reportScope, reportScope)) {
            pendingViewportAnchorRef.current = null;
            return;
        }
        pendingViewportAnchorRef.current = null;
        const anchored =
            nodes.find((node) => node.id === anchor.nodeId) ?? nodes.find((node) => node.id === anchor.fallbackNodeId);
        if (anchored === undefined) {
            return;
        }
        const { zoom } = getViewport();
        void setViewport({
            x: anchor.paneX - anchored.position.x * zoom,
            y: anchor.paneY - anchored.position.y * zoom,
            zoom,
        });
    }, [nodes, reportScope, getViewport, setViewport]);

    const toggleOperationExpansion = useCallback(
        (targetOperationId: number) => {
            const nodeId = String(targetOperationId);
            const node = getNode(nodeId);
            if (node) {
                const { x, y, zoom } = getViewport();
                pendingViewportAnchorRef.current = {
                    nodeId,
                    fallbackNodeId: nodeId,
                    paneX: node.position.x * zoom + x,
                    paneY: node.position.y * zoom + y,
                    reportScope,
                };
            }
            setExpandedOperationIds((previous) => {
                const next = new Set(previous);
                // A failed delete means it wasn't expanded, so this is the expand.
                if (!next.delete(targetOperationId)) {
                    next.add(targetOperationId);
                }
                return next;
            });
        },
        [getNode, getViewport, reportScope],
    );

    const armViewportAnchor = useCallback(
        (nodeId: string, fallbackNodeId: string) => {
            const node = getNode(nodeId) ?? getNode(fallbackNodeId);
            if (!node) {
                return;
            }
            const { x, y, zoom } = getViewport();
            pendingViewportAnchorRef.current = {
                nodeId,
                fallbackNodeId,
                paneX: node.position.x * zoom + x,
                paneY: node.position.y * zoom + y,
                reportScope,
            };
        },
        [getNode, getViewport, reportScope],
    );

    const toggleBlockExpansion = useCallback(
        (instanceId: string) => {
            const block = detectedBlocks.find((entry) => entry.instanceId === instanceId);
            const firstOpId = block?.operationIds[0];
            armViewportAnchor(instanceId, firstOpId === undefined ? instanceId : String(firstOpId));
            setExpandedBlockIds((previous) => {
                const next = new Set(previous);
                if (next.delete(instanceId)) {
                    if (block !== undefined) {
                        setExpandedOperationIds((expandedOps) => {
                            const remaining = new Set(expandedOps);
                            for (const memberOpId of block.operationIds) {
                                remaining.delete(memberOpId);
                            }
                            return remaining;
                        });
                    }
                } else {
                    next.add(instanceId);
                }
                return next;
            });
        },
        [armViewportAnchor, detectedBlocks],
    );

    const expandAllBlocks = useCallback(() => {
        setExpandedBlockIds(new Set(detectedBlocks.map((block) => block.instanceId)));
    }, [detectedBlocks]);

    const collapseAllBlocks = useCallback(() => {
        setExpandedBlockIds(NOTHING_EXPANDED_BLOCKS);
        const collapsedMembers = new Set(detectedBlocks.flatMap((block) => block.operationIds));
        setExpandedOperationIds((previous) => {
            const next = new Set(previous);
            for (const memberOpId of collapsedMembers) {
                next.delete(memberOpId);
            }
            return next;
        });
    }, [detectedBlocks]);

    const handleHideDeallocateChange = useCallback((next: boolean) => {
        setHideDeallocate(next);
        setExpandedBlockIds(NOTHING_EXPANDED_BLOCKS);
        setExpandedOperationIds(NOTHING_EXPANDED);
    }, []);

    if (operationId !== undefined && revealedOperationId !== operationId && detectedBlocks.length > 0) {
        setRevealedOperationId(operationId);
        const buried = detectedBlocks.find((block) => block.operationIds.includes(operationId));
        if (buried !== undefined && !expandedBlockIds.has(buried.instanceId)) {
            setExpandedBlockIds(new Set([...expandedBlockIds, buried.instanceId]));
        }
    }

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
        const buriedCountById = new Map<string, number>();
        let hiddenMatchCount = 0;
        for (const entry of nodeIndex) {
            if (filterMatcher.test(entry.name)) {
                ids.add(entry.id);
                operationIdsInOrder.push(entry.operationId);
            } else {
                let buried = 0;
                for (const memberName of entry.memberNames ?? []) {
                    if (filterMatcher.test(memberName)) {
                        buried += 1;
                    }
                }
                if (buried > 0) {
                    ids.add(entry.id);
                    operationIdsInOrder.push(entry.operationId);
                    buriedCountById.set(entry.id, buried);
                    hiddenMatchCount += buried;
                }
            }
        }
        return { ids, operationIdsInOrder, hiddenMatchCount, buriedCountById };
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

    // Keyed by the operations an edge joins, not by its endpoints: an edge into an
    // expanded operation renders onto one of its device operations, and keying by
    // that would hide it from the operation's own neighbourhood.
    const { edgesBySource, edgesByTarget } = useMemo(() => {
        const bySource = new Map<string, OpGraphFlowEdge[]>();
        const byTarget = new Map<string, OpGraphFlowEdge[]>();
        for (const edge of edges) {
            const boundary = operationBoundaryOf(edge, nodeIdByOperationId);
            if (boundary !== null) {
                const outgoing = bySource.get(boundary.source);
                if (outgoing) {
                    outgoing.push(edge);
                } else {
                    bySource.set(boundary.source, [edge]);
                }
                const incoming = byTarget.get(boundary.target);
                if (incoming) {
                    incoming.push(edge);
                } else {
                    byTarget.set(boundary.target, [edge]);
                }
            }
        }
        return { edgesBySource: bySource, edgesByTarget: byTarget };
    }, [edges, nodeIdByOperationId]);

    const highlight = useMemo(() => {
        if (selectedOperationId === null) {
            return null;
        }
        const selectedId = operationNodeIdOf(selectedOperationId, nodeIdByOperationId) ?? String(selectedOperationId);
        const relationByNodeId = new Map<string, NodeRelation>();
        const relationByEdgeId = new Map<string, NodeRelation>();
        // Outputs first: a neighbour on both sides of a cycle reads as an input,
        // matching vis's precedence.
        // The neighbour is marked by its operation node, whether that renders
        // collapsed or as the group around an expanded subgraph.
        for (const edge of edgesBySource.get(selectedId) ?? []) {
            const targetId = operationNodeIdOf(targetOperationIdOf(edge), nodeIdByOperationId);
            if (targetId !== null) {
                relationByNodeId.set(targetId, NodeRelation.Output);
                relationByEdgeId.set(edge.id, NodeRelation.Output);
            }
        }
        for (const edge of edgesByTarget.get(selectedId) ?? []) {
            const sourceId = operationNodeIdOf(sourceOperationIdOf(edge), nodeIdByOperationId);
            if (sourceId !== null) {
                relationByNodeId.set(sourceId, NodeRelation.Input);
                relationByEdgeId.set(edge.id, NodeRelation.Input);
            }
        }
        return { selectedId, relationByNodeId, relationByEdgeId };
    }, [selectedOperationId, edgesBySource, edgesByTarget, nodeIdByOperationId]);

    const graphOperationIds = useMemo(() => {
        const ids: number[] = [];
        for (const entry of nodeIndex) {
            if (entry.memberOperationIds !== undefined) {
                ids.push(...entry.memberOperationIds);
            } else {
                ids.push(entry.operationId);
            }
        }
        return ids;
    }, [nodeIndex]);

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

    const isCriticalPathActive = isCriticalPathEnabled && perfOverlay.status === PerfOverlayStatus.READY;

    // The path runs over operations, so an edge rendering into an expanded node has
    // to be presented as reaching the node: `findCriticalPath` drops edges whose
    // endpoints it has no node for, and the dependency would go missing. Edge ids
    // are preserved so the returned set still matches what is rendered.
    const topologyEdges = useMemo(() => {
        const topology: Array<{ id: string; source: string; target: string }> = [];
        for (const edge of builtEdges) {
            const boundary = operationBoundaryOf(edge, nodeIdByOperationId);
            if (boundary !== null) {
                topology.push({ id: edge.id, ...boundary });
            }
        }
        return topology;
    }, [builtEdges, nodeIdByOperationId]);

    const criticalPath = useMemo(() => {
        if (!isCriticalPathActive) {
            return EMPTY_CRITICAL_PATH;
        }
        const deviceTimeNsByOpId = new Map<number, number>();
        for (const [opId, aggregate] of perfOverlay.aggregatesByOpId) {
            deviceTimeNsByOpId.set(opId, aggregate.deviceTimeNs);
        }
        return findCriticalPath(nodeIndex, topologyEdges, deviceTimeNsByOpId);
    }, [isCriticalPathActive, perfOverlay, nodeIndex, topologyEdges]);

    useEffect(() => {
        if (criticalPath.hasCycle) {
            // Edges follow each tensor's consumer list, which nothing constrains
            // to run forwards, so a cycle is a property of the report rather than
            // a bug here. The annotation says the path is partial; this names the
            // reason for whoever is debugging the report.
            // eslint-disable-next-line no-console
            console.warn('operation graph critical path: cycle found, path covers the acyclic portion only');
        }
    }, [criticalPath]);

    // Null rather than an empty set so the styling passes below can keep their
    // early bail, and their memo identity, while the feature is off. Both keyed
    // on the node set: a single-node path has no edges, and dimming everything
    // around one outlined node is still the right read.
    const hasCriticalPath = criticalPath.nodeIds.size > 0;
    const criticalPathNodeIds = hasCriticalPath ? criticalPath.nodeIds : null;
    const criticalPathEdgeIds = hasCriticalPath ? criticalPath.edgeIds : null;

    // Built once per score change so the styling pass reuses these identities
    // instead of allocating one per node on every drag frame.
    const perfStyleByNodeId = useMemo(
        () => buildPerfNodeStyleByNodeId(perfOverlay, isPerfOverlayActive, nodeIndex),
        [isPerfOverlayActive, perfOverlay, nodeIndex],
    );

    const styledNodes = useMemo(() => {
        if (!highlight && !matchedIds && !perfStyleByNodeId && !criticalPathNodeIds) {
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
            // search dims everything around it. A device operation follows the
            // operation holding it — React Flow renders children as siblings, so
            // without this they would dim inside a lit parent and read as a
            // rendering fault rather than as "these didn't match".
            if (
                matchedIds &&
                (isSelected ||
                    matchedIds.has(node.id) ||
                    (node.type === OpGraphNodeType.DEVICE_OP && matchedIds.has(String(node.data.operationId))))
            ) {
                classNames.push(MATCHED_NODE_CLASS);
            }
            if (criticalPathNodeIds?.has(node.id)) {
                classNames.push(CRITICAL_PATH_NODE_CLASS);
            }
            const className = classNames.length > 0 ? classNames.join(' ') : undefined;
            // Custom properties only, so perf stacks with selection, the
            // highlight and the inherited filter dim instead of displacing any.
            const perfStyle = perfStyleByNodeId?.get(node.id);
            const buriedMatchCount = matches.buriedCountById.get(node.id) ?? 0;
            const nextData =
                buriedMatchCount > 0 && node.data.buriedMatchCount !== buriedMatchCount
                    ? { ...node.data, buriedMatchCount }
                    : node.data;

            if (className === undefined && perfStyle === undefined && nextData === node.data) {
                return node;
            }

            // A drag frame hands back a new array with one new node object, so a
            // node dressed again here would lose the identity React Flow diffs
            // on. Both inputs are stable — the patches are rebuilt only when the
            // scores change — so an untouched node hits the cache and keeps the
            // object it was given.
            const cached = styledNodeCache.get(node);
            if (
                cached !== undefined &&
                cached.className === className &&
                cached.perfStyle === perfStyle &&
                cached.styled.data.buriedMatchCount === nextData.buriedMatchCount
            ) {
                return cached.styled;
            }

            const styled = {
                ...node,
                data: nextData,
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
    }, [
        nodes,
        highlight,
        matchedIds,
        matches.buriedCountById,
        perfStyleByNodeId,
        criticalPathNodeIds,
        styledNodeCache,
    ]);

    const styledEdges = useMemo(() => {
        if (!highlight && !matchedIds && !criticalPathEdgeIds) {
            return edges;
        }
        return edges.map((edge) => {
            const relation = highlight?.relationByEdgeId.get(edge.id);
            const classNames: string[] = [];
            if (relation) {
                classNames.push(EDGE_CLASS_BY_RELATION[relation]);
            }
            if (criticalPathEdgeIds?.has(edge.id)) {
                classNames.push(CRITICAL_PATH_EDGE_CLASS);
            }
            // An edge between two matches stays lit so the matched subset is
            // traceable; a selection edge outranks the filter either way.
            if (matchedIds && (relation || bothEndsMatched(edge, matchedIds, nodeIdByOperationId))) {
                classNames.push(MATCHED_EDGE_CLASS);
            }
            return classNames.length > 0 ? { ...edge, className: classNames.join(' ') } : edge;
        });
    }, [edges, highlight, matchedIds, criticalPathEdgeIds, nodeIdByOperationId]);

    const handleNodeClick = useCallback(
        (_event: ReactMouseEvent, node: OpGraphFlowNode) => {
            selectOperation(node.data.operationId);
        },
        [selectOperation],
    );

    const handleNodeDoubleClick = useCallback(
        (_event: ReactMouseEvent, node: OpGraphFlowNode) => {
            if (node.data.blockInstanceId !== undefined) {
                toggleBlockExpansion(node.data.blockInstanceId);
                return;
            }
            const instance = detectedBlocks.find(
                (block) => expandedBlockIds.has(block.instanceId) && block.operationIds.includes(node.data.operationId),
            );
            if (instance !== undefined) {
                toggleBlockExpansion(instance.instanceId);
            }
        },
        [detectedBlocks, expandedBlockIds, toggleBlockExpansion],
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

    const handleCriticalPathChange = useCallback(
        (next: boolean) => setCriticalPathScope(next ? reportScope : null),
        [setCriticalPathScope, reportScope],
    );

    const perfHoverLabel = useMemo(
        () =>
            isPerfOverlayActive && perfHover !== null ? getPerfHoverLabel(perfOverlay, perfHover.operationId) : null,
        [isPerfOverlayActive, perfHover, perfOverlay],
    );

    const selectedBlock = useMemo(() => {
        if (selectedOperationId === null) {
            return null;
        }
        return (
            detectedBlocks.find(
                (block) => !expandedBlockIds.has(block.instanceId) && block.operationIds.includes(selectedOperationId),
            ) ?? null
        );
    }, [selectedOperationId, detectedBlocks, expandedBlockIds]);

    const selectedPerfAggregate =
        selectedOperationId === null ? undefined : perfOverlay.aggregatesByOpId.get(selectedOperationId);
    const selectedPerfScore =
        selectedOperationId === null ? undefined : perfOverlay.scoreByOpId.get(selectedOperationId);
    const selectedPerfDeviceTimeNs = useMemo(() => {
        if (!isPerfOverlayActive) {
            return undefined;
        }
        if (selectedBlock === null) {
            return selectedPerfAggregate?.deviceTimeNs;
        }
        let totalNs = 0;
        let found = false;
        for (const memberId of selectedBlock.operationIds) {
            const aggregate = perfOverlay.aggregatesByOpId.get(memberId);
            if (aggregate !== undefined) {
                totalNs += aggregate.deviceTimeNs;
                found = true;
            }
        }
        return found ? totalNs : undefined;
    }, [isPerfOverlayActive, selectedBlock, selectedPerfAggregate, perfOverlay]);

    // Closed mid-build so the panel can't describe an operation the graph being
    // laid out is about to drop.
    const isPanelOpen = selectedOperationId !== null && !isBuilding;

    const containerClassName = [
        'operation-graph-react-flow',
        ...(matchedIds ? [FILTERING_CLASS] : []),
        ...(hasCriticalPath ? [CRITICAL_PATH_CLASS] : []),
        ...(focusUnrelatedEdges && highlight !== null ? [FOCUS_EDGES_CLASS] : []),
    ].join(' ');

    return (
        <div
            className={containerClassName}
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
                onHideDeallocateChange={handleHideDeallocateChange}
                focusUnrelatedEdges={focusUnrelatedEdges}
                onFocusUnrelatedEdgesChange={setFocusUnrelatedEdges}
                hiddenMatchCount={matches.hiddenMatchCount}
                hasBlocks={detectedBlocks.length > 0}
                areAllBlocksExpanded={
                    detectedBlocks.length > 0 && detectedBlocks.every((block) => expandedBlockIds.has(block.instanceId))
                }
                areAllBlocksCollapsed={
                    detectedBlocks.length === 0 ||
                    detectedBlocks.every((block) => !expandedBlockIds.has(block.instanceId))
                }
                onExpandAllBlocks={expandAllBlocks}
                onCollapseAllBlocks={collapseAllBlocks}
                isPerfOverlayActive={isPerfOverlayActive}
                onPerfOverlayChange={handlePerfOverlayChange}
                isCriticalPathActive={isCriticalPathActive}
                onCriticalPathChange={handleCriticalPathChange}
                perfOverlayStatus={perfOverlay.status}
                linkedOpCount={perfOverlay.linkedOpCount}
                totalOpCount={perfOverlay.totalOpCount}
                isDisabled={isBuilding}
            />
            <OpGraphExpansionContext.Provider value={toggleOperationExpansion}>
                <OpGraphBlockExpansionContext.Provider value={toggleBlockExpansion}>
                    <ReactFlow<OpGraphFlowNode, OpGraphFlowEdge>
                        nodes={styledNodes}
                        edges={styledEdges}
                        nodeTypes={NODE_TYPES}
                        edgeTypes={EDGE_TYPES}
                        onNodesChange={handleNodesChange}
                        onEdgesChange={onEdgesChange}
                        onNodeClick={handleNodeClick}
                        onNodeDoubleClick={handleNodeDoubleClick}
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
                </OpGraphBlockExpansionContext.Provider>
            </OpGraphExpansionContext.Provider>
            <div className='op-graph-bottom-band'>
                {isCriticalPathActive && hasCriticalPath && !isBuilding ? (
                    <CriticalPathAnnotation
                        opCount={criticalPath.opCount}
                        totalNs={criticalPath.totalNs}
                        measuredNs={perfOverlay.totalNs}
                        isPartial={criticalPath.hasCycle}
                    />
                ) : null}
                {isPerfOverlayActive && !isBuilding ? (
                    <PerfOverlayLegend
                        minNs={perfOverlay.minNs}
                        maxNs={perfOverlay.maxNs}
                    />
                ) : null}
            </div>
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
                    operationById={operationById}
                    operationNamesById={operationNamesById}
                    onLocateOperation={focusOperation}
                    isPerfOverlayActive={isPerfOverlayActive}
                    perfDeviceTimeNs={selectedPerfDeviceTimeNs}
                    perfColor={
                        selectedBlock === null && selectedPerfScore !== undefined
                            ? perfColorScale(selectedPerfScore.t)
                            : undefined
                    }
                    block={selectedBlock}
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
