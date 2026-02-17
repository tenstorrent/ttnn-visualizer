// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Edge, IdType, Network } from 'vis-network';
import { DataSet } from 'vis-data';
import 'vis-network/styles/vis-network.css';
import { Button, ButtonVariant, Intent, Label, PopoverPosition, Slider, Switch, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { NavigateFunction, useNavigate } from 'react-router';
import { OperationDescription, Tensor } from '../model/APIData';
import '../scss/components/OperationGraphComponent.scss';
import LoadingSpinner from './LoadingSpinner';
import MemoryConfigRow from './MemoryConfigRow';
import { ShardSpec } from '../functions/parseMemoryConfig';
import { BufferType } from '../model/BufferType';
import { toReadableShape, toReadableType } from '../functions/formatting';
import SearchField from './SearchField';
import MemoryTag from './MemoryTag';
import { GRAPH_COLORS } from '../definitions/GRAPH_COLORS';

type OperationList = OperationDescription[];
const DEALLOCATE_OP_NAME = 'ttnn.deallocate';

const OperationGraph: React.FC<{
    operationList: OperationList;
    operationId?: number;
}> = ({ operationList, operationId }) => {
    let focusNodeId = operationId !== undefined ? operationId : (operationList[0].id ?? 0);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const navigate = useNavigate();

    const [isLoading, setIsLoading] = useState(true);
    const [scale, setScale] = useState(1);
    const [currentOperationId, setCurrentOperationId] = useState<number | null>(focusNodeId ?? null);
    const [nodeNameFilter, setNodeNameFilter] = useState<string>('');
    const [filteredNodeIdList, setFilteredNodeIdList] = useState<number[]>([]);
    const [currentFilteredIndex, setCurrentFilteredIndex] = useState<number | null>(null);
    const [filterOutDeallocate, setFilterOutDeallocate] = useState<boolean>(true);
    const networkRef = useRef<Network | null>(null);
    const currentOpIdRef = useRef<number>(currentOperationId);
    const [compactView, setCompactView] = useState<boolean>(false);

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

    if (currentOperationId !== null && !connectedNodeIds.has(currentOperationId)) {
        const val = connectedNodeIds.values().next().value;

        focusNodeId = val;
        setCurrentOperationId(val);
    }

    const nodes = useMemo(
        () =>
            new DataSet(
                operationList
                    .filter((op) => connectedNodeIds.has(op.id))
                    .filter((op) => !filterOutDeallocate || !op.name.toLowerCase().includes(DEALLOCATE_OP_NAME))
                    .map((op) => ({
                        id: op.id,
                        label: `${op.id} ${op.name} \n ${op.operationFileIdentifier}`,
                        shape: 'box',
                        filterString: `${op.name}`,
                        deviceOpFilter: op.deviceOperationNameList.join(' '),
                    })),
            ),
        [operationList, connectedNodeIds, filterOutDeallocate],
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
            edges: edgesDataSetRef.current,
        }),
        [nodes],
    );

    const colorHighlightIO = useCallback(
        (selectedNodeId: IdType) => {
            const allNodes = nodes.get();

            const allEdges = edgesDataSetRef.current.get();

            const inputNodeIds = new Set<IdType | undefined>();
            const outputNodeIds = new Set<IdType | undefined>();
            const inputEdgeIds = new Set<IdType | undefined>();
            const outputEdgeIds = new Set<IdType | undefined>();

            for (const edge of allEdges) {
                if (edge.to === selectedNodeId) {
                    inputNodeIds.add(edge.from);
                    inputEdgeIds.add(edge.id);
                }

                if (edge.from === selectedNodeId) {
                    outputNodeIds.add(edge.to);
                    outputEdgeIds.add(edge.id);
                }
            }
            nodes.update(
                allNodes.map((node) => {
                    if (node.id === selectedNodeId) {
                        return node;
                    }

                    if (inputNodeIds.has(node.id)) {
                        return {
                            id: node.id,
                            color: { background: GRAPH_COLORS.inputNode },
                        };
                    }

                    if (outputNodeIds.has(node.id)) {
                        return {
                            id: node.id,
                            color: { background: GRAPH_COLORS.outputNode },
                        };
                    }

                    return {
                        id: node.id,
                        color: { background: GRAPH_COLORS.normal },
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
        [nodes],
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
                    console.error('Error selecting node', e);
                }
            }
        },

        [scale],
    );

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
                        focusOnNode(currentOperationId);
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
                        content={
                            previousOperation
                                ? `Go to previous operation ${previousOperation}`
                                : 'No previous operation'
                        }
                        disabled={isLoading}
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
                        content={nextOperation ? `Go to next operation ${nextOperation}` : 'No next operation'}
                        disabled={isLoading}
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
                    currentOperationId={currentOperationId}
                    onNavigate={navigate}
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

            <aside className='aside'>
                Scroll or pinch graph to zoom. Drag to pan. Click a node to see operation details. Drag a node to move
                horizontally.
            </aside>
        </div>
    );
};

const TensorDetailsComponent: React.FC<{ tensor: Tensor }> = ({ tensor }) => {
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
const OperationGraphInfoComponent: React.FC<{
    currentOperationId: number;
    operationList: OperationList;
    onNavigate: NavigateFunction;
}> = ({ currentOperationId, operationList, onNavigate }) => {
    const operation = operationList.find((op) => op.id === currentOperationId);
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
            <Button
                className='navigate-button'
                endIcon={IconNames.SEGMENTED_CONTROL}
                intent={Intent.PRIMARY}
                onClick={() => onNavigate(`/operations/${currentOperationId}`)}
            >
                Memory Details
            </Button>

            <h3>Inputs:</h3>
            <div className='inputs tensors'>
                {operation?.inputs.map((tensor, index) => (
                    <TensorDetailsComponent
                        tensor={tensor}
                        key={`input-${currentOperationId} ${tensor.id} ${index}`}
                    />
                ))}
            </div>
            <h3>Outputs:</h3>
            <div className='outputs tensors'>
                {operation?.outputs.map((tensor, index) => (
                    <TensorDetailsComponent
                        tensor={tensor}
                        key={`output-${currentOperationId} ${tensor.id} ${index}`}
                    />
                ))}
            </div>
        </div>
    );
};

export default OperationGraph;
