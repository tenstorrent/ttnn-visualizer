// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import React, { useEffect, useRef, useState } from 'react';
import { Network } from 'vis-network';
import { DataSet } from 'vis-data';
import 'vis-network/styles/vis-network.css';
import { Button, PopoverPosition, Slider, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useNavigate } from 'react-router';
import { OperationDescription } from '../model/APIData';
import ROUTES from '../definitions/routes';
import '../scss/components/OperationGraphComponent.scss';

type OperationList = OperationDescription[];

const OperationGraph: React.FC<{
    operationList: OperationList;
    operationId?: number | undefined;
}> = ({ operationList, operationId }) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const navigate = useNavigate();
    const networkRef = useRef<Network | null>(null);

    const [scale, setScale] = useState(1);
    const edges = operationList.flatMap((op) =>
        op.outputs.flatMap((tensor) =>
            tensor.consumers.map((consumerId) => ({
                from: op.id,
                to: consumerId,
                arrows: 'to',
                label: `${tensor.id}`,
            })),
        ),
    );

    const connectedNodeIds = new Set<number>();
    edges.forEach(({ from, to }) => {
        connectedNodeIds.add(from);
        connectedNodeIds.add(to);
    });

    const nodes = new DataSet(
        operationList
            .filter((op) => connectedNodeIds.has(op.id))
            .map((op) => ({
                id: op.id,
                label: `${op.id} ${op.name}`,
                shape: 'box',
            })),
    );
    const focusNodeId = operationId !== undefined ? operationId : (nodes.getIds()[0] as number) ?? 0;
    const [currentOperationId, setCurrentOperationId] = useState(focusNodeId);

    const updateScale = (newScale: number) => {
        const limitedScale = Math.min(newScale, 3);
        setScale(limitedScale);
        networkRef.current?.moveTo({ scale: limitedScale });
    };

    // eslint-disable-next-line consistent-return
    useEffect(() => {
        if (containerRef.current) {
            networkRef.current = new Network(
                containerRef.current,
                { nodes, edges },
                {
                    nodes: {
                        font: {
                            color: '#202020',
                        },
                        color: {
                            background: '#ccd2f9',
                            border: 'none',
                            hover: {
                                background: '#9ca8f2',
                                border: 'none',
                            },
                            highlight: {
                                background: '#74c5df',
                                border: '#f6bc42',
                            },
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
                    },
                    physics: {
                        enabled: false,
                    },
                },
            );

            networkRef.current.once('afterDrawing', () => {
                networkRef.current?.focus(focusNodeId, {
                    scale,
                    animation: { duration: 500, easingFunction: 'easeInOutQuad' },
                });
                networkRef.current?.selectNodes([focusNodeId], true);
            });

            networkRef.current.on('zoom', (params) => {
                if (params.scale <= 3) {
                    setScale(params.scale);
                } else {
                    networkRef.current?.moveTo({ scale: 3 });
                }
            });
            networkRef.current.on('click', (params) => {
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
                    }
                }
            });

            return () => {
                networkRef.current?.off('zoom');
                networkRef.current?.off('click');
                networkRef.current?.off('dragEnd');
                networkRef.current?.destroy();
                networkRef.current = null;
            };
        }
        // because we know better and dont want re-renders here.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const focusOnNode = (nodeId: number | null) => {
        if (nodeId === null) {
            return;
        }
        if (networkRef.current) {
            networkRef.current.focus(nodeId, {
                scale,
                animation: { duration: 500, easingFunction: 'easeInQuad' },
            });
            networkRef.current.selectNodes([nodeId], true);
            setCurrentOperationId(nodeId);
        }
    };

    const getNextOperationId = (currentId: number) => {
        const nodeIds = nodes.getIds();
        const currentIndex = nodeIds.indexOf(currentId);
        return currentIndex !== -1 && currentIndex < nodeIds.length - 1 ? (nodeIds[currentIndex + 1] as number) : null;
    };

    const getPreviousOperationId = (currentId: number) => {
        const nodeIds = nodes.getIds();
        const currentIndex = nodeIds.indexOf(currentId);
        return currentIndex > 0 ? (nodeIds[currentIndex - 1] as number) : null;
    };

    return (
        <div className='operation-graph-component'>
            <div className='operation-graph-header'>
                <div className='operation-graph-nav'>
                    <Tooltip
                        placement={PopoverPosition.TOP}
                        content={`Go to previous operation ${getPreviousOperationId(currentOperationId)}`}
                    >
                        <Button
                            icon={IconNames.ArrowLeft}
                            onClick={() => focusOnNode(getPreviousOperationId(currentOperationId))}
                            disabled={getPreviousOperationId(currentOperationId) === null}
                        />
                    </Tooltip>
                    <Tooltip
                        placement={PopoverPosition.TOP}
                        content={`Center on ${currentOperationId}`}
                    >
                        <Button onClick={() => focusOnNode(currentOperationId)}>{currentOperationId}</Button>
                    </Tooltip>
                    <Tooltip
                        placement={PopoverPosition.TOP}
                        content={`Go to next operation ${getNextOperationId(currentOperationId)}`}
                    >
                        <Button
                            icon={IconNames.ArrowRight}
                            onClick={() => focusOnNode(getNextOperationId(currentOperationId))}
                            disabled={getNextOperationId(currentOperationId) === null}
                        />
                    </Tooltip>
                </div>
                <div style={{ width: '250px' }}>
                    <Slider
                        min={0.1}
                        max={3}
                        labelRenderer={(value) => `${value.toFixed(2)}`}
                        stepSize={0.01}
                        labelStepSize={0.75}
                        labelPrecision={1}
                        value={scale}
                        onChange={updateScale}
                    />
                </div>
            </div>
            <div
                ref={containerRef}
                style={{ width: '100%', height: 'calc(100vh - 200px)' }}
            />
            <div>
                <aside>Click on a node to see operation details</aside>
            </div>
        </div>
    );
};

export default OperationGraph;
