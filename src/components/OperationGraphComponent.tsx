// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Edge, Network } from 'vis-network';
import { DataSet } from 'vis-data';
import 'vis-network/styles/vis-network.css';
import { Button, Label, PopoverPosition, Slider, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useNavigate } from 'react-router';
import { OperationDescription } from '../model/APIData';
import ROUTES from '../definitions/routes';
import '../scss/components/OperationGraphComponent.scss';
import LoadingSpinner from './LoadingSpinner';
// eslint-disable-next-line import/default
import GraphWorker from '../graphWorker?worker';

type OperationList = OperationDescription[];

const OperationGraph: React.FC<{
    operationList: OperationList;
    operationId?: number;
}> = ({ operationList, operationId }) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const navigate = useNavigate();
    const networkRef = useRef<Network | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [scale, setScale] = useState(1);
    const [nodes, setNodes] = useState<DataSet<{ id: number; label: string; shape: string }> | null>(null);

    const focusNodeId = operationId !== undefined ? operationId : operationList[0].id ?? 0;
    const [currentOperationId, setCurrentOperationId] = useState<number>(operationId ?? 0);
    const currentOpIdRef = useRef<number>(currentOperationId);

    const updateScale = useCallback(
        (newScale: number) => {
            const limitedScale = Math.min(newScale, 3);
            setScale(limitedScale);
            networkRef.current?.moveTo({ scale: limitedScale });
        },
        [networkRef],
    );

    useEffect(() => {
        setIsLoading(true);
        const worker = new GraphWorker();
        worker.postMessage({ operationList });

        worker.onmessage = (event) => {
            const { edges, nodes: rawNodes } = event.data;

            if (containerRef.current) {
                requestAnimationFrame(() => {
                    const nodeDataSet = new DataSet(rawNodes);
                    setNodes(nodeDataSet as DataSet<{ id: number; label: string; shape: string }>);

                    networkRef.current = new Network(
                        containerRef.current!,
                        {
                            nodes: nodeDataSet as DataSet<{ id: number; label: string; shape: string }>,
                            edges: edges as Edge[],
                        },
                        {
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
                            },
                            edges: {
                                font: { color: '#f5e2ba', size: 20, strokeColor: '#000' },
                                color: '#f5e2ba',
                                arrows: { to: { enabled: true, scaleFactor: 0.5 } },
                            },
                            autoResize: true,
                            layout: {
                                hierarchical: {
                                    enabled: true,
                                    levelSeparation: 200,
                                    nodeSpacing: 200,
                                    treeSpacing: 300,
                                    blockShifting: true,
                                    edgeMinimization: true,
                                    direction: 'UD',
                                    sortMethod: 'directed',
                                    shakeTowards: 'leaves',
                                },
                            },
                            interaction: {
                                hover: true,
                                keyboard: true,
                                dragView: true,
                                zoomView: true,
                                zoomSpeed: 0.2,
                            },
                            physics: { enabled: false },
                        },
                    );

                    networkRef.current.once('afterDrawing', () => {
                        setIsLoading(false);
                        networkRef.current?.focus(focusNodeId, {
                            scale,
                            animation: { duration: 500, easingFunction: 'easeInOutQuad' },
                        });
                        networkRef.current?.selectNodes([focusNodeId], true);
                        setCurrentOperationId(focusNodeId);
                        currentOpIdRef.current = focusNodeId;
                    });

                    networkRef.current.on('click', (params) => {
                        if (params.edges.length > 0) {
                            const edgeId = params.edges[0];
                            const edge = edges.find((e: { id: number }) => e.id === edgeId);

                            if ((edge.to as number) === currentOpIdRef.current) {
                                // ability to navigate back if we are clicking on the input tensor to current
                                focusOnNode((edge?.from as number) || null);
                            } else {
                                focusOnNode((edge?.to as number) || null);
                            }
                        }
                        if (params.nodes.length > 0) {
                            navigate(`${ROUTES.OPERATIONS}/${params.nodes[0]}`);
                        }
                    });

                    networkRef.current.on('dragEnd', () => {
                        if (networkRef.current) {
                            const centerPosition = networkRef.current.getViewPosition();
                            const nodePositions = networkRef.current.getPositions();

                            const closestNodeId = Object.keys(nodePositions).reduce(
                                (closestId, nodeId) => {
                                    const pos = nodePositions[nodeId];
                                    const distance = Math.sqrt(
                                        (centerPosition.x - pos.x) ** 2 + (centerPosition.y - pos.y) ** 2,
                                    );
                                    if (
                                        closestId === null ||
                                        distance <
                                            Math.sqrt(
                                                (centerPosition.x - nodePositions[closestId].x) ** 2 +
                                                    (centerPosition.y - nodePositions[closestId].y) ** 2,
                                            )
                                    ) {
                                        return nodeId;
                                    }
                                    return closestId;
                                },
                                null as string | null,
                            );
                            if (closestNodeId) {
                                networkRef.current.selectNodes([closestNodeId], true);
                                setCurrentOperationId(parseInt(closestNodeId, 10));
                                currentOpIdRef.current = parseInt(closestNodeId, 10);
                            }
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
        };

        return () => {
            worker.terminate();
            networkRef.current?.off('zoom');
            networkRef.current?.off('click');
            networkRef.current?.off('dragEnd');
            networkRef.current?.off('afterDrawing');
            networkRef.current?.destroy();
            networkRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const getNextOperationId = (currentId: number) => {
        if (nodes === null) {
            return null;
        }
        const nodeIds = nodes.getIds();
        const currentIndex = nodeIds.indexOf(currentId);
        return currentIndex !== -1 && currentIndex < nodeIds.length - 1 ? (nodeIds[currentIndex + 1] as number) : null;
    };

    const getPreviousOperationId = (currentId: number) => {
        if (nodes === null) {
            return null;
        }
        const nodeIds = nodes.getIds();
        const currentIndex = nodeIds.indexOf(currentId);
        return currentIndex > 0 ? (nodeIds[currentIndex - 1] as number) : null;
    };
    const focusOnNode = useCallback(
        (nodeId: number | null) => {
            if (nodeId === null) {
                return;
            }
            if (networkRef.current) {
                networkRef.current.focus(nodeId, {
                    scale,
                    animation: { duration: 500, easingFunction: 'easeInOutCubic' },
                });
                networkRef.current.selectNodes([nodeId], true);
                setCurrentOperationId(nodeId);
                currentOpIdRef.current = nodeId;
            }
        },
        [networkRef, scale],
    );
    return (
        <div className='operation-graph-component'>
            <div className='operation-graph-header'>
                <div className='operation-graph-nav'>
                    <Tooltip
                        placement={PopoverPosition.TOP}
                        content={`Go to previous operation ${getPreviousOperationId(currentOperationId)}`}
                        disabled={isLoading}
                    >
                        <Button
                            icon={IconNames.ArrowLeft}
                            onClick={() => focusOnNode(getPreviousOperationId(currentOperationId) || 0)}
                            disabled={!getPreviousOperationId(currentOperationId) || isLoading}
                            outlined
                        />
                    </Tooltip>
                    <Tooltip
                        disabled={isLoading}
                        placement={PopoverPosition.TOP}
                        content={`Center on operation ${currentOperationId}`}
                    >
                        <Button
                            outlined
                            onClick={() => focusOnNode(currentOperationId)}
                            disabled={isLoading}
                        >
                            {currentOperationId}
                        </Button>
                    </Tooltip>
                    <Tooltip
                        placement={PopoverPosition.TOP}
                        content={`Go to next operation ${getNextOperationId(currentOperationId)}`}
                        disabled={isLoading}
                    >
                        <Button
                            icon={IconNames.ArrowRight}
                            onClick={() => focusOnNode(getNextOperationId(currentOperationId) || 0)}
                            disabled={!getNextOperationId(currentOperationId) || isLoading}
                            outlined
                        />
                    </Tooltip>
                </div>
                <div className='slider-wrapper'>
                    <Label disabled={isLoading}>Scale</Label>
                    <Slider
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
            {isLoading && (
                <div className='graph-tree-loader'>
                    <LoadingSpinner />
                </div>
            )}
            <div
                ref={containerRef}
                style={{ width: '100%', height: 'calc(100vh - 120px)' }}
            />
            <div>
                <aside>Scroll to zoom. Drag to pan. Click a node to see operation details.</aside>
            </div>
        </div>
    );
};

export default OperationGraph;
