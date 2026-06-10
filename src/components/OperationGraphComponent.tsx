// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Edge, IdType, Network, Node } from 'vis-network';
import { DataSet } from 'vis-data';
import 'vis-network/styles/vis-network.css';
import { Button, ButtonVariant, Intent, Label, PopoverPosition, Slider, Switch, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { NavigateFunction, useNavigate } from 'react-router';
import tinycolor from 'tinycolor2';
import { useAtomValue } from 'jotai';
import { OperationDescription, Tensor } from '../model/APIData';
import 'styles/components/OperationGraphComponent.scss';
import LoadingSpinner from './LoadingSpinner';
import SourceFileButton from './operation-details/SourceFileButton';
import { extractOperationSourceData } from '../functions/stackTraceSource';
import { StackTraceLanguage } from '../definitions/StackTrace';
import MemoryConfigRow from './MemoryConfigRow';
import { ShardSpec } from '../functions/parseMemoryConfig';
import { BufferType } from '../model/BufferType';
import { formatDuration, toReadableShape, toReadableType } from '../functions/formatting';
import SearchField from './SearchField';
import MemoryTag from './MemoryTag';
import { GRAPH_COLORS } from '../definitions/GraphColors';
import { DEALLOCATE_OP_NAME_LIST } from '../definitions/Deallocate';
import {
    PERF_GRADIENT_CSS,
    PerfOverlaySource,
    aggregatePerfByOp,
    isDarkPerfColor,
    perfColorScale,
    scoreOps,
} from '../functions/perfOverlay';
import { activePerformanceReportAtom, activeProfilerReportAtom } from '../store/app';

type OperationList = OperationDescription[];

type OperationNode = Node & {
    id: number;
    filterString: string;
    deviceOpFilter: string;
};

enum NodeRelation {
    Input = 'input',
    Output = 'output',
}

enum PerfOverlayStatus {
    UNAVAILABLE,
    UNLINKED,
    READY,
}

const PERF_OVERLAY_TOOLTIP: Record<PerfOverlayStatus, string> = {
    [PerfOverlayStatus.UNAVAILABLE]: 'Load a performance report to enable perf overlay.',
    [PerfOverlayStatus.UNLINKED]: "Loaded performance report doesn't match this graph (no operations in common).",
    [PerfOverlayStatus.READY]: 'Colour and size nodes by per-op kernel duration.',
};

// Node label colours used for nodes whose background is light enough for the
// default dark glyph (every state except the cold/hot ends of the perf ramp)
// and for nodes that flip to a dark perf overlay background.
const DEFAULT_NODE_FONT_COLOR = '#202020';
const LIGHT_NODE_FONT_COLOR = '#f5f5f5';

interface OperationGraphProps {
    operationList: OperationList;
    operationId?: number;
    perfRows?: PerfOverlaySource[];
    /**
     * Whether *any* perf report is currently loaded for this profiler report,
     * independent of whether it links up. Lets the overlay distinguish
     * "load a report to enable this" (UNAVAILABLE) from "loaded report
     * doesn't match" (UNLINKED). When omitted, the component infers
     * availability from `perfRows.length > 0`, which only works in tests
     * that bypass the linking pipeline.
     */
    isPerfReportLoaded?: boolean;
}

const OperationGraph = ({ operationList, operationId, perfRows, isPerfReportLoaded }: OperationGraphProps) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const navigate = useNavigate();

    const [isLoading, setIsLoading] = useState(true);
    const [scale, setScale] = useState(1);
    const [currentOperationId, setCurrentOperationId] = useState<number | null>(
        () => operationId ?? operationList[0]?.id ?? null,
    );
    const [nodeNameFilter, setNodeNameFilter] = useState<string>('');
    const [filteredNodeIdList, setFilteredNodeIdList] = useState<number[]>([]);
    const [currentFilteredIndex, setCurrentFilteredIndex] = useState<number | null>(null);
    const [filterOutDeallocate, setFilterOutDeallocate] = useState<boolean>(true);
    const networkRef = useRef<Network | null>(null);
    const currentOpIdRef = useRef<number>(currentOperationId);
    const blinkIntervalRef = useRef<number | null>(null);
    const blinkTimeoutRef = useRef<number | null>(null);
    const [compactView, setCompactView] = useState<boolean>(false);
    // Perf overlay toggle is intentionally local — it shouldn't persist across
    // sessions or carry over to a different report. The effect below resets it
    // to off whenever the active profiler or performance report changes, so a
    // newly loaded report always starts with the overlay off.
    const [perfOverlayEnabled, setPerfOverlayEnabled] = useState<boolean>(false);
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    useEffect(() => {
        setPerfOverlayEnabled(false);
    }, [activeProfilerReport, activePerformanceReport]);

    const perfAggregates = useMemo(() => aggregatePerfByOp(perfRows ?? []), [perfRows]);
    const { scoreByOpId, minNs, maxNs } = useMemo(() => scoreOps(perfAggregates), [perfAggregates]);

    const linkedOpCount = useMemo(() => {
        if (scoreByOpId.size === 0) {
            return 0;
        }
        let count = 0;
        for (const op of operationList) {
            if (scoreByOpId.has(op.id)) {
                count += 1;
            }
        }
        return count;
    }, [operationList, scoreByOpId]);

    // Availability is "is any perf report loaded at all", linking is "do the
    // ops actually overlap". Splitting these lets the tooltip say "load a
    // report" only when there genuinely is none, and "this report doesn't
    // match this graph" when one is loaded but the run is wrong. Caller can
    // omit `isPerfReportLoaded` (tests / storybook), in which case we fall
    // back to the row-count heuristic — same behaviour as before for those
    // contexts.
    const isPerfReportAvailable = isPerfReportLoaded ?? (perfRows !== undefined && perfRows.length > 0);
    const perfOverlayStatus: PerfOverlayStatus = useMemo(() => {
        if (!isPerfReportAvailable) {
            return PerfOverlayStatus.UNAVAILABLE;
        }
        if (linkedOpCount === 0) {
            return PerfOverlayStatus.UNLINKED;
        }
        return PerfOverlayStatus.READY;
    }, [isPerfReportAvailable, linkedOpCount]);

    // The atom remembers user intent across sessions, but we only honour it when
    // perf data is actually available and joined to this graph.
    const perfOverlayActive = perfOverlayEnabled && perfOverlayStatus === PerfOverlayStatus.READY;

    const deviceTimeByOpId = useMemo(() => {
        const result = new Map<number, number>();
        for (const a of perfAggregates.values()) {
            result.set(a.opId, a.deviceTimeNs);
        }
        return result;
    }, [perfAggregates]);

    // Resolve the (background, label colour) pair for a non-input/output node.
    // We pair these because the perf overlay's two cold bins push the node bg
    // dark enough that the default `#202020` label drifts into the canvas
    // background. The non-overlay path is always light so we keep the default
    // label colour there.
    const getNonIONodeStyle = useCallback(
        (nodeId: IdType): { background: string; fontColor: string } => {
            if (!perfOverlayActive) {
                return { background: GRAPH_COLORS.normal, fontColor: DEFAULT_NODE_FONT_COLOR };
            }
            const score = scoreByOpId.get(nodeId as number);
            if (!score) {
                return { background: GRAPH_COLORS.normal, fontColor: DEFAULT_NODE_FONT_COLOR };
            }
            const background = perfColorScale(score.t);
            return {
                background,
                fontColor: isDarkPerfColor(background) ? LIGHT_NODE_FONT_COLOR : DEFAULT_NODE_FONT_COLOR,
            };
        },
        [perfOverlayActive, scoreByOpId],
    );

    const edges = useMemo((): Edge[] => {
        const edgeMap = new Map<string, Edge>();
        return operationList.flatMap((op) =>
            op.outputs.flatMap((tensor) =>
                tensor.consumers.map((consumerId) => {
                    const edge = {
                        from: op.id,
                        to: consumerId,
                        arrows: 'to',
                        label: toReadableShape(tensor.shape),
                        color: GRAPH_COLORS.normal,
                    } as Edge;

                    if (edgeMap.has(`${edge.from}-${edge.to}`)) {
                        // If an edge already exists, make it curved to avoid overlap
                        return {
                            ...edge,
                            smooth: { type: 'curvedCCW', roundness: 0.2 },
                        } as Edge;
                    }
                    edgeMap.set(`${edge.from}-${edge.to}`, edge);

                    return edge;
                }),
            ),
        );
    }, [operationList]);

    const connectedNodeIds = useMemo(() => {
        const ids = new Set<number>();
        edges.forEach(({ from, to }) => {
            ids.add(from as number);
            ids.add(to as number);
        });
        return ids;
    }, [edges]);

    const operationNamesById = useMemo(() => {
        const map = new Map<number, string>();
        operationList.forEach((op) => map.set(op.id, op.name));
        return map;
    }, [operationList]);

    let focusNodeId: number;
    if (currentOperationId !== null && connectedNodeIds.has(currentOperationId)) {
        focusNodeId = currentOperationId;
    } else if (connectedNodeIds.size > 0) {
        focusNodeId = connectedNodeIds.values().next().value!;
    } else {
        focusNodeId = operationId ?? operationList[0]?.id ?? 0;
    }

    useEffect(() => {
        if (connectedNodeIds.size === 0) {
            return;
        }
        if (currentOperationId !== null && !connectedNodeIds.has(currentOperationId)) {
            const fallbackId = connectedNodeIds.values().next().value;
            if (fallbackId !== undefined && fallbackId !== currentOperationId) {
                setCurrentOperationId(fallbackId);
            }
        }
    }, [connectedNodeIds, currentOperationId]);

    const nodes = useMemo(
        () =>
            new DataSet<OperationNode>(
                operationList
                    .filter((op) => connectedNodeIds.has(op.id))
                    .filter((op) => !filterOutDeallocate || !DEALLOCATE_OP_NAME_LIST.includes(op.name.toLowerCase()))
                    .map((op) => {
                        const score = perfOverlayActive ? scoreByOpId.get(op.id) : undefined;
                        const base = {
                            id: op.id,
                            label: `${op.id} ${op.name}${
                                op.operationFileIdentifier ? `\n${op.operationFileIdentifier}` : ''
                            }`,
                            shape: 'box',
                            filterString: `${op.name}`,
                            deviceOpFilter: op.deviceOperationNameList.join(' '),
                        };
                        if (!score) {
                            return base;
                        }
                        const background = perfColorScale(score.t);
                        const fontColor = isDarkPerfColor(background) ? LIGHT_NODE_FONT_COLOR : DEFAULT_NODE_FONT_COLOR;
                        return {
                            ...base,
                            color: { background },
                            font: { color: fontColor },
                        };
                    }),
            ),
        [operationList, connectedNodeIds, filterOutDeallocate, perfOverlayActive, scoreByOpId],
    );
    const edgesDataSetRef = useRef<DataSet<Edge>>(new DataSet());

    useEffect(() => {
        const ds = edgesDataSetRef.current;

        ds.clear();
        ds.add(edges);
    }, [edges]);

    const data = useMemo(
        () => ({
            nodes,
            // eslint-disable-next-line react-hooks/refs
            edges: edgesDataSetRef.current,
        }),
        [nodes],
    );

    const colorHighlightIO = useCallback(
        (selectedNodeId: IdType) => {
            const allNodes = nodes.get();

            const allEdges = edgesDataSetRef.current.get();

            const nextInputNodeIds = new Set<IdType>();
            const nextOutputNodeIds = new Set<IdType>();
            const inputEdgeIds = new Set<IdType | undefined>();
            const outputEdgeIds = new Set<IdType | undefined>();

            for (const edge of allEdges) {
                if (edge.to === selectedNodeId && edge.from !== undefined) {
                    nextInputNodeIds.add(edge.from);
                    inputEdgeIds.add(edge.id);
                }

                if (edge.from === selectedNodeId && edge.to !== undefined) {
                    nextOutputNodeIds.add(edge.to);
                    outputEdgeIds.add(edge.id);
                }
            }

            nodes.update(
                allNodes.map((node) => {
                    if (node.id === selectedNodeId) {
                        return node;
                    }

                    if (nextInputNodeIds.has(node.id)) {
                        return {
                            id: node.id,
                            color: { background: GRAPH_COLORS.inputNode },
                        };
                    }

                    if (nextOutputNodeIds.has(node.id)) {
                        return {
                            id: node.id,
                            color: { background: GRAPH_COLORS.outputNode },
                        };
                    }

                    const style = getNonIONodeStyle(node.id);
                    return {
                        id: node.id,
                        color: { background: style.background },
                        font: { color: style.fontColor },
                    };
                }),
            );

            const edgesToUpdate = allEdges
                .map((edge) => {
                    if (inputEdgeIds.has(edge.id)) {
                        return {
                            id: edge.id,
                            color: GRAPH_COLORS.inputEdge,
                        };
                    }
                    if (outputEdgeIds.has(edge.id)) {
                        return {
                            id: edge.id,
                            color: GRAPH_COLORS.outputEdge,
                        };
                    }
                    if (edge.color !== GRAPH_COLORS.normal) {
                        return {
                            id: edge.id,
                            color: GRAPH_COLORS.normal,
                        };
                    }
                    return null;
                })
                .filter(Boolean);
            edgesDataSetRef.current.update(edgesToUpdate);
        },
        [nodes, getNonIONodeStyle],
    );

    const focusOnNode = useCallback(
        (nodeId: number | null) => {
            if (networkRef.current && nodeId !== null) {
                networkRef.current.focus(nodeId, {
                    scale,
                    animation: { duration: 500, easingFunction: 'easeInOutCubic' },
                });

                // Node might not exist if it's a deallocate op and we are filtering them out
                try {
                    networkRef.current.selectNodes([nodeId], true);
                    setCurrentOperationId(nodeId);
                    // @ts-expect-error this is normal
                    currentOpIdRef.current = nodeId;
                } catch (e) {
                    // eslint-disable-next-line no-console
                    console.warn('Error selecting node', e);
                }
            }
        },

        [scale],
    );

    const getNodeRelationToFocused = useCallback((nodeId: IdType): NodeRelation | null => {
        const selectedNodeId = currentOpIdRef.current;
        if (selectedNodeId === null || selectedNodeId === undefined || nodeId === selectedNodeId) {
            return null;
        }
        const allEdges = edgesDataSetRef.current.get();
        for (const edge of allEdges) {
            if (edge.to === selectedNodeId && edge.from === nodeId) {
                return NodeRelation.Input;
            }
            if (edge.from === selectedNodeId && edge.to === nodeId) {
                return NodeRelation.Output;
            }
        }
        return null;
    }, []);

    // Both restore- and blink-on styles must round-trip the (background, label
    // colour) pair so the perf-overlay dark bins don't strand a white label on
    // a freshly restored light grey node. The blink-on colours are always
    // light by construction (lightened input/output, orange focused), so they
    // can hard-code the default label.
    const getRestoreStyleForNode = useCallback(
        (nodeId: IdType): { color: { background: string }; font: { color: string } } => {
            const relation = getNodeRelationToFocused(nodeId);
            if (relation === NodeRelation.Input) {
                return { color: { background: GRAPH_COLORS.inputNode }, font: { color: DEFAULT_NODE_FONT_COLOR } };
            }
            if (relation === NodeRelation.Output) {
                return { color: { background: GRAPH_COLORS.outputNode }, font: { color: DEFAULT_NODE_FONT_COLOR } };
            }
            const style = getNonIONodeStyle(nodeId);
            return { color: { background: style.background }, font: { color: style.fontColor } };
        },
        [getNodeRelationToFocused, getNonIONodeStyle],
    );

    const getBlinkOnStyleForNode = useCallback(
        (nodeId: IdType): { color: { background: string }; font: { color: string } } => {
            const relation = getNodeRelationToFocused(nodeId);
            const font = { color: DEFAULT_NODE_FONT_COLOR };
            if (relation === NodeRelation.Input) {
                return { color: { background: tinycolor(GRAPH_COLORS.inputNode).lighten(20).toString() }, font };
            }
            if (relation === NodeRelation.Output) {
                return { color: { background: tinycolor(GRAPH_COLORS.outputNode).lighten(20).toString() }, font };
            }
            return { color: { background: GRAPH_COLORS.focusedNode }, font };
        },
        [getNodeRelationToFocused],
    );

    const blinkNode = useCallback(
        (nodeId: number) => {
            if (blinkIntervalRef.current !== null) {
                window.clearInterval(blinkIntervalRef.current);
                blinkIntervalRef.current = null;
            }
            if (blinkTimeoutRef.current !== null) {
                window.clearTimeout(blinkTimeoutRef.current);
                blinkTimeoutRef.current = null;
            }

            if (!nodes.get(nodeId)) {
                return;
            }

            const onStyle = getBlinkOnStyleForNode(nodeId);
            const offStyle = getRestoreStyleForNode(nodeId);
            let isOn = true;
            nodes.update({ id: nodeId, ...onStyle });

            blinkIntervalRef.current = window.setInterval(() => {
                isOn = !isOn;
                nodes.update({ id: nodeId, ...(isOn ? onStyle : offStyle) });
            }, 300);

            blinkTimeoutRef.current = window.setTimeout(() => {
                if (blinkIntervalRef.current !== null) {
                    window.clearInterval(blinkIntervalRef.current);
                    blinkIntervalRef.current = null;
                }
                blinkTimeoutRef.current = null;
                nodes.update({ id: nodeId, ...getRestoreStyleForNode(nodeId) });
            }, 3000);
        },
        [nodes, getRestoreStyleForNode, getBlinkOnStyleForNode],
    );

    const locateConnectedNode = useCallback(
        (nodeId: number) => {
            if (!networkRef.current) {
                return;
            }
            try {
                networkRef.current.focus(nodeId, {
                    scale,
                    animation: { duration: 500, easingFunction: 'easeInOutCubic' },
                });
            } catch (e) {
                // eslint-disable-next-line no-console
                console.warn('Error focusing viewport on node', e);
                return;
            }
            blinkNode(nodeId);
        },
        [scale, blinkNode],
    );

    const recenterOnCurrentOperation = useCallback(() => {
        if (currentOperationId === null) {
            return;
        }
        focusOnNode(currentOperationId);
    }, [currentOperationId, focusOnNode]);

    const updateScale = useCallback(
        (newScale: number) => {
            const limitedScale = Math.min(newScale, 3);
            setScale(limitedScale);
            networkRef.current?.moveTo({ scale: limitedScale });
        },
        [networkRef],
    );

    const nextFilteredIndex = useMemo(() => {
        if (currentFilteredIndex === null || filteredNodeIdList.length === 0) {
            return 0;
        }
        return (currentFilteredIndex + 1) % filteredNodeIdList.length;
    }, [currentFilteredIndex, filteredNodeIdList.length]);
    const previousFilteredIndex = useMemo(() => {
        if (currentFilteredIndex === null || filteredNodeIdList.length === 0) {
            return 0;
        }
        return (currentFilteredIndex - 1 + filteredNodeIdList.length) % filteredNodeIdList.length;
    }, [currentFilteredIndex, filteredNodeIdList.length]);

    const navigateFilteredNodes = useCallback(
        (index: number, firstNode?: number | null) => {
            if (networkRef.current && !isLoading) {
                if (firstNode !== undefined && firstNode !== null) {
                    focusOnNode(firstNode);
                } else if (filteredNodeIdList.length > index) {
                    focusOnNode(filteredNodeIdList[index]);
                    networkRef.current.selectNodes(filteredNodeIdList, false);
                }
            }
            setCurrentFilteredIndex(index);
        },

        [isLoading, filteredNodeIdList, focusOnNode],
    );

    const clearFilteredNodes = () => {
        setFilteredNodeIdList([]);
        setCurrentFilteredIndex(null);
        setNodeNameFilter('');
        if (networkRef.current) {
            networkRef.current.selectNodes([], true);
            networkRef.current.focus(focusNodeId, {
                scale,
                animation: { duration: 500, easingFunction: 'easeInOutQuad' },
            });
            setCurrentOperationId(focusNodeId);
        }
    };
    const filterNodes = (query: string) => {
        if (!query) {
            setFilteredNodeIdList([]);
            return null;
        }
        const filteredNodes = nodes.get({
            filter: (node) => node.filterString?.toLowerCase().includes(query.toLowerCase()),
        });
        const nodeIdList = filteredNodes.map((node) => node.id);
        networkRef?.current?.selectNodes(nodeIdList, false);
        setFilteredNodeIdList(nodeIdList);
        return nodeIdList[0] || null;
    };

    useEffect(() => {
        setIsLoading(true);

        // allow the ui to render loading state before initializing the graph
        setTimeout(() => {
            if (containerRef.current) {
                requestAnimationFrame(() => {
                    networkRef.current = new Network(containerRef.current!, data, {
                        nodes: {
                            font: { color: '#202020' },
                            color: {
                                background: '#ccd2f9',
                                border: 'none',
                                hover: { background: '#9ca8f2', border: 'none' },
                                highlight: { background: '#74c5df', border: '#f6bc42' },
                            },
                            size: 20,
                            labelHighlightBold: false,
                            shape: 'box',
                            fixed: false,
                        },
                        edges: {
                            font: { color: '#f5e2ba', size: 18, strokeColor: '#000' },
                            color: '#fff',
                            arrows: { to: { enabled: true, scaleFactor: 0.5 } },
                            smooth: { enabled: true, type: 'cubicBezier', roundness: 0.5 },
                            physics: true,
                        },
                        autoResize: true,
                        layout: {
                            hierarchical: {
                                enabled: true,
                                levelSeparation: 200,
                                nodeSpacing: 700,
                                treeSpacing: 700,
                                blockShifting: true,
                                edgeMinimization: !compactView,
                                direction: 'UD',
                                sortMethod: 'directed',
                                shakeTowards: 'leaves',
                            },
                            improvedLayout: true,
                        },

                        interaction: {
                            hover: true,
                            keyboard: true,
                            dragView: true,
                            zoomView: true,
                            zoomSpeed: 0.15,
                        },
                        physics: { enabled: false },
                    });

                    networkRef.current.once('afterDrawing', () => {
                        networkRef.current?.moveTo({ scale });
                        focusOnNode(focusNodeId);
                        colorHighlightIO(focusNodeId);
                        setIsLoading(false);
                        // @ts-expect-error this is normal
                        currentOpIdRef.current = focusNodeId;
                    });

                    networkRef.current.on('click', (params) => {
                        if (params.nodes.length > 0) {
                            const nodeId = params.nodes[0];
                            focusOnNode(nodeId);
                            colorHighlightIO(nodeId);
                            return;
                        }
                        if (params.edges.length > 0) {
                            const edgeId = params.edges[0];
                            const edge = edges.find((e) => e.id === edgeId);

                            if ((edge?.to as number) === currentOpIdRef.current) {
                                // ability to navigate back if we are clicking on the input tensor to current
                                focusOnNode((edge?.from as number) || null);
                            } else {
                                focusOnNode((edge?.to as number) || null);
                            }
                        } else {
                            networkRef.current?.selectNodes([], true);
                            setCurrentOperationId(null);
                            // @ts-expect-error this is normal
                            currentOpIdRef.current = null;
                        }
                    });

                    networkRef.current.on('zoom', (params) => {
                        if (params.scale <= 3) {
                            setScale(params.scale);
                        } else {
                            networkRef.current?.moveTo({ scale: 3 });
                        }
                    });
                });
            }
        });

        return () => {
            if (blinkIntervalRef.current !== null) {
                window.clearInterval(blinkIntervalRef.current);
                blinkIntervalRef.current = null;
            }
            if (blinkTimeoutRef.current !== null) {
                window.clearTimeout(blinkTimeoutRef.current);
                blinkTimeoutRef.current = null;
            }
            networkRef.current?.off('zoom');
            networkRef.current?.off('click');
            networkRef.current?.off('dragEnd');
            networkRef.current?.off('afterDrawing');
            networkRef.current?.destroy();
            networkRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [edges, nodes, data, compactView]);

    const getNextOperationId = (currentId: number | null) => {
        if (nodes === null || currentId === null) {
            return null;
        }
        const nodeIds = nodes.getIds();
        const currentIndex = nodeIds.indexOf(currentId);
        return currentIndex !== -1 && currentIndex < nodeIds.length - 1 ? (nodeIds[currentIndex + 1] as number) : null;
    };

    const getPreviousOperationId = (currentId: number | null) => {
        if (nodes === null || currentId === null) {
            return null;
        }
        const nodeIds = nodes.getIds();
        const currentIndex = nodeIds.indexOf(currentId);
        return currentIndex > 0 ? (nodeIds[currentIndex - 1] as number) : null;
    };

    const focusedNode = currentOperationId ?? operationList[0].id;

    const previousOperation = getPreviousOperationId(currentOperationId);
    const nextOperation = getNextOperationId(currentOperationId);

    return (
        <div className='operation-graph-component'>
            <div className='operation-graph-header'>
                <div className='operation-graph-nav'>
                    <Tooltip
                        placement={PopoverPosition.TOP}
                        content={`Go to previous operation ${previousOperation}`}
                        disabled={isLoading || !previousOperation}
                    >
                        <Button
                            icon={IconNames.ArrowLeft}
                            onClick={() => focusOnNode(previousOperation || null)}
                            disabled={!previousOperation || isLoading}
                            variant={ButtonVariant.OUTLINED}
                            aria-label={
                                previousOperation
                                    ? `Go to previous operation ${previousOperation}`
                                    : 'No previous operation'
                            }
                        />
                    </Tooltip>
                    <Tooltip
                        disabled={isLoading}
                        placement={PopoverPosition.TOP}
                        content={`Center on operation ${focusedNode}`}
                    >
                        <Button
                            variant={ButtonVariant.OUTLINED}
                            onClick={() => focusOnNode(focusedNode)}
                            disabled={isLoading}
                            aria-label={`Center on operation ${focusedNode}`}
                        >
                            {focusedNode}
                        </Button>
                    </Tooltip>
                    <Tooltip
                        placement={PopoverPosition.TOP}
                        content={`Go to next operation ${nextOperation}`}
                        disabled={isLoading || !nextOperation}
                    >
                        <Button
                            icon={IconNames.ArrowRight}
                            onClick={() => focusOnNode(nextOperation || null)}
                            disabled={!nextOperation || isLoading}
                            variant={ButtonVariant.OUTLINED}
                            aria-label={nextOperation ? `Go to next operation ${nextOperation}` : 'No next operation'}
                        />
                    </Tooltip>
                    <SearchField
                        searchQuery={nodeNameFilter}
                        onQueryChanged={(query) => {
                            if (!query) {
                                clearFilteredNodes();
                            } else {
                                setNodeNameFilter(query);
                                const firstNode = filterNodes(query);
                                navigateFilteredNodes(0, firstNode);
                            }
                        }}
                        placeholder='Filter by operation name'
                        disabled={isLoading}
                    />
                    <Button
                        icon={IconNames.ArrowLeft}
                        onClick={() => {
                            navigateFilteredNodes(previousFilteredIndex);
                        }}
                        disabled={isLoading || filteredNodeIdList.length === 0}
                        variant={ButtonVariant.OUTLINED}
                        aria-label='Previous result'
                    />
                    {currentFilteredIndex !== null && filteredNodeIdList.length > 0 ? currentFilteredIndex + 1 : 0}/
                    {filteredNodeIdList.length}
                    <Button
                        icon={IconNames.ArrowRight}
                        onClick={() => {
                            navigateFilteredNodes(nextFilteredIndex);
                        }}
                        disabled={isLoading || filteredNodeIdList.length === 0}
                        variant={ButtonVariant.OUTLINED}
                        aria-label='Next result'
                    />
                    <Switch
                        checked={filterOutDeallocate}
                        onChange={() => setFilterOutDeallocate(!filterOutDeallocate)}
                        label='Hide deallocate ops'
                        disabled={isLoading}
                    />
                    <Switch
                        checked={compactView}
                        onChange={() => setCompactView(!compactView)}
                        label='Compact view'
                        disabled={isLoading}
                    />
                    <Tooltip
                        content={PERF_OVERLAY_TOOLTIP[perfOverlayStatus]}
                        placement={PopoverPosition.BOTTOM}
                    >
                        <Switch
                            checked={perfOverlayActive}
                            onChange={() => setPerfOverlayEnabled(!perfOverlayEnabled)}
                            label='Perf overlay'
                            disabled={isLoading || perfOverlayStatus !== PerfOverlayStatus.READY}
                        />
                    </Tooltip>
                </div>
                <div className='slider-wrapper'>
                    <Label disabled={isLoading}>Scale</Label>
                    <Slider
                        handleHtmlProps={{
                            'aria-label': 'Scale slider',
                        }}
                        min={0.1}
                        max={3}
                        labelRenderer={(value) => `${value.toFixed(2)}`}
                        stepSize={0.01}
                        labelStepSize={0.75}
                        labelPrecision={1}
                        value={scale}
                        onChange={updateScale}
                        disabled={isLoading}
                    />
                </div>
            </div>
            {currentOperationId !== null && !isLoading && (
                <OperationGraphInfoComponent
                    operationList={operationList}
                    operationNamesById={operationNamesById}
                    currentOperationId={currentOperationId}
                    onNavigate={navigate}
                    onLocateConnectedNode={locateConnectedNode}
                    onRecenterOnCurrent={recenterOnCurrentOperation}
                    perfOverlayActive={perfOverlayActive}
                    perfDeviceTimeNs={deviceTimeByOpId.get(currentOperationId)}
                    perfColor={(() => {
                        const score = scoreByOpId.get(currentOperationId);
                        return score ? perfColorScale(score.t) : undefined;
                    })()}
                />
            )}
            {isLoading && (
                <div className='graph-tree-loader'>
                    <LoadingSpinner />
                </div>
            )}
            <div
                className='operation-graph-container'
                ref={containerRef}
            />

            {perfOverlayActive && !isLoading && (
                <PerfOverlayLegend
                    minNs={minNs}
                    maxNs={maxNs}
                />
            )}

            <aside className='aside'>
                Scroll or pinch graph to zoom. Drag to pan. Click a node to see operation details. Drag a node to move
                horizontally.
            </aside>
        </div>
    );
};

interface PerfOverlayLegendProps {
    minNs: number;
    maxNs: number;
}

export const PerfOverlayLegend = ({ minNs, maxNs }: PerfOverlayLegendProps) => (
    <div
        className='perf-overlay-legend'
        aria-label='Perf overlay legend'
    >
        <div className='perf-overlay-legend-title'>Kernel duration (log)</div>
        <div
            className='perf-overlay-legend-gradient'
            style={{ background: PERF_GRADIENT_CSS }}
            aria-hidden='true'
        />
        <div className='perf-overlay-legend-bounds'>
            <span>{formatDuration(minNs)}</span>
            <span>{formatDuration(maxNs)}</span>
        </div>
    </div>
);

interface PerfOverlayOpMetricProps {
    perfDeviceTimeNs?: number;
    /** Same colour the node is rendered with on the graph — keeps the panel
     *  visually tied to the overlay. */
    perfColor?: string;
}

export const PerfOverlayOpMetric = ({ perfDeviceTimeNs, perfColor }: PerfOverlayOpMetricProps) => (
    <div className='perf-overlay-op-metric'>
        <span className='perf-overlay-op-metric-label'>Kernel duration</span>
        <span className='perf-overlay-op-metric-value'>
            {perfColor && perfDeviceTimeNs !== undefined && (
                <span
                    className='perf-overlay-op-metric-swatch'
                    style={{ backgroundColor: perfColor }}
                    aria-hidden='true'
                />
            )}
            {perfDeviceTimeNs !== undefined ? formatDuration(perfDeviceTimeNs) : 'No perf data'}
        </span>
    </div>
);

interface OperationGraphTensorDetailsProps {
    tensor: Tensor;
}

const TensorDetailsComponent = ({ tensor }: OperationGraphTensorDetailsProps) => {
    return (
        <div className='tensor-details'>
            <h3 className='tensor-header'>
                <span>{tensor.buffer_type !== null && <MemoryTag memory={BufferType[tensor.buffer_type]} />}</span>{' '}
                {toReadableShape(tensor.shape)} Tensor {tensor.id}{' '}
            </h3>

            <div>{toReadableType(tensor.dtype)}</div>
            <div>{tensor.layout}</div>
            <div>{tensor.operationIdentifier && [tensor.operationIdentifier]}</div>
            {tensor?.memory_config
                ? Object.entries(tensor.memory_config).map(([key, value]) => (
                      <table key={key}>
                          <tbody>
                              <MemoryConfigRow
                                  key={key}
                                  header={key}
                                  value={value as string | ShardSpec}
                              />
                          </tbody>
                      </table>
                  ))
                : null}
        </div>
    );
};
type ConnectedOpGroup = {
    key: string;
    label: string;
    opId: number | null;
    tensors: Tensor[];
};

const groupTensorsByConnectedOp = (
    tensors: Tensor[] | undefined,
    direction: NodeRelation,
    operationNamesById: Map<number, string>,
): ConnectedOpGroup[] => {
    if (!tensors?.length) {
        return [];
    }

    const groups = new Map<string, ConnectedOpGroup>();

    tensors.forEach((tensor) => {
        const ids = direction === NodeRelation.Input ? tensor.producers : tensor.consumers;
        const names = direction === NodeRelation.Input ? tensor.producerNames : tensor.consumerNames;

        if (!ids.length) {
            const key = direction === NodeRelation.Input ? 'external-input' : 'external-output';
            const label = direction === NodeRelation.Input ? 'External input' : 'Unconsumed output';
            const group = groups.get(key) ?? { key, label, opId: null, tensors: [] };
            group.tensors.push(tensor);
            groups.set(key, group);
            return;
        }

        ids.forEach((opId, index) => {
            const key = String(opId);
            const name = operationNamesById.get(opId) ?? names[index] ?? '';
            const label = `${opId} ${name}`.trim();
            const group = groups.get(key) ?? { key, label, opId, tensors: [] };
            group.tensors.push(tensor);
            groups.set(key, group);
        });
    });

    return Array.from(groups.values());
};

interface ConnectedOpHeaderProps {
    group: ConnectedOpGroup;
    onLocate: (opId: number) => void;
}

const ConnectedOpHeader = ({ group, onLocate }: ConnectedOpHeaderProps) => {
    return (
        <div className='connected-op-header'>
            <h2 className='connected-op-name'>{group.label}</h2>
            {group.opId !== null && (
                <Tooltip
                    placement={PopoverPosition.RIGHT}
                    content={`Locate operation ${group.opId} in graph`}
                >
                    <Button
                        className='connected-op-select'
                        icon={IconNames.LOCATE}
                        variant={ButtonVariant.MINIMAL}
                        onClick={() => onLocate(group.opId as number)}
                        aria-label={`Locate operation ${group.opId} in graph`}
                    />
                </Tooltip>
            )}
        </div>
    );
};

interface OperationGraphInfoComponentProps {
    currentOperationId: number;
    operationList: OperationList;
    operationNamesById: Map<number, string>;
    onNavigate: NavigateFunction;
    onLocateConnectedNode: (opId: number) => void;
    onRecenterOnCurrent: () => void;
    perfOverlayActive: boolean;
    /** Aggregated max device_time in ns for the selected op, if any. */
    perfDeviceTimeNs?: number;
    /** Pre-computed overlay colour for the selected op. */
    perfColor?: string;
}

const OperationGraphInfoComponent = ({
    currentOperationId,
    operationList,
    operationNamesById,
    onNavigate,
    onLocateConnectedNode,
    onRecenterOnCurrent,
    perfOverlayActive,
    perfDeviceTimeNs,
    perfColor,
}: OperationGraphInfoComponentProps) => {
    const operation = operationList.find((op) => op.id === currentOperationId);
    const operationSourceData = operation ? extractOperationSourceData(operation) : null;

    const inputGroups = useMemo(
        () => groupTensorsByConnectedOp(operation?.inputs, NodeRelation.Input, operationNamesById),
        [operation, operationNamesById],
    );
    const outputGroups = useMemo(
        () => groupTensorsByConnectedOp(operation?.outputs, NodeRelation.Output, operationNamesById),
        [operation, operationNamesById],
    );

    return (
        <div className='operation-graph-props'>
            <h2 className='operation-name'>
                {currentOperationId} {operation?.name} ({operation?.operationFileIdentifier})
            </h2>
            <ul className='device-operation-list'>
                {operation?.deviceOperationNameList.map((deviceOp, index) => (
                    <li key={`device-op-${index}`}>{deviceOp}()</li>
                ))}
            </ul>
            <div className='operation-actions'>
                <Button
                    className='navigate-button'
                    endIcon={IconNames.SEGMENTED_CONTROL}
                    intent={Intent.PRIMARY}
                    onClick={() => onNavigate(`/operations/${currentOperationId}`)}
                >
                    Memory Details
                </Button>

                <Button
                    className='recenter-button'
                    icon={IconNames.LOCATE}
                    intent={Intent.PRIMARY}
                    onClick={onRecenterOnCurrent}
                    aria-label={`Recenter on operation ${currentOperationId}`}
                >
                    Locate {currentOperationId}
                </Button>

                {operationSourceData && operation && (
                    <SourceFileButton
                        filePath={operationSourceData.filePath}
                        sourceFileId={operation.stack_trace_source_file_id}
                        lineNumber={operationSourceData.lineNumber}
                        language={StackTraceLanguage.PYTHON}
                        variant={ButtonVariant.OUTLINED}
                        ariaLabel={`View source for operation ${operation.id} ${operation.name}`}
                        eagerProbe
                    />
                )}
            </div>

            {perfOverlayActive && (
                <PerfOverlayOpMetric
                    perfDeviceTimeNs={perfDeviceTimeNs}
                    perfColor={perfColor}
                />
            )}

            <h3 className='inputs'>Inputs:</h3>
            <div className='inputs tensors'>
                {inputGroups.map((group) => (
                    <div
                        className='connected-op'
                        key={`input-op-${currentOperationId}-${group.key}`}
                    >
                        <ConnectedOpHeader
                            group={group}
                            onLocate={onLocateConnectedNode}
                        />
                        {group.tensors.map((tensor, index) => (
                            <TensorDetailsComponent
                                tensor={tensor}
                                key={`input-${currentOperationId}-${group.key}-${tensor.id}-${index}`}
                            />
                        ))}
                    </div>
                ))}
            </div>
            <h3 className='outputs'>Outputs:</h3>
            <div className='outputs tensors'>
                {outputGroups.map((group) => (
                    <div
                        className='connected-op'
                        key={`output-op-${currentOperationId}-${group.key}`}
                    >
                        <ConnectedOpHeader
                            group={group}
                            onLocate={onLocateConnectedNode}
                        />
                        {group.tensors.map((tensor, index) => (
                            <TensorDetailsComponent
                                tensor={tensor}
                                key={`output-${currentOperationId}-${group.key}-${tensor.id}-${index}`}
                            />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default OperationGraph;
