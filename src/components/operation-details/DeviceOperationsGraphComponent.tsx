// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DataSet, Network } from 'vis-network/standalone';
import { Edge } from 'vis-network';
import { Button, ButtonVariant, Card, Overlay2, Size } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { Node } from '../../model/APIData';
import { getTensorColor } from '../../functions/colorGenerator';
import 'styles/components/DeviceOperationsGraphComponent.scss';
import { toReadableShape } from '../../functions/formatting';

export interface GraphComponentProps {
    data: Node[];
    open: boolean;
    onClose: () => void;
}

const GraphComponent: React.FC<GraphComponentProps> = ({ data, open, onClose }) => {
    const networkRef = useRef<Network | null>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const [tooltipContent, setTooltipContent] = useState<React.ReactNode>(null);
    const focusOnNode = useCallback(
        (nodeId: number | null, center: boolean = false) => {
            if (nodeId === null) {
                return;
            }
            if (networkRef.current) {
                if (center) {
                    networkRef.current.focus(nodeId, {
                        animation: { duration: 500, easingFunction: 'easeInOutCubic' },
                    });
                }
                networkRef.current.selectNodes([nodeId], true);

                const nodeData = data.find((node) => node.id === nodeId);
                if (nodeData && tooltipRef.current) {
                    setTooltipContent(generateTooltipContent(nodeData));
                    tooltipRef.current.classList.add('visible');
                }
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [data],
    );

    const formatOperationName = (item: Node) => {
        // const prefix = item.node_type === 'function_start' ? 'Start ' : '';
        // const suffix = item.node_type === 'function_end' ? 'end' : '';
        return item.params.name ? `${item.params.name}()` : '';
    };
    const getTensorSquare = (tensorId: number | null) => {
        return (
            tensorId && (
                <div
                    className='memory-color-block'
                    style={{
                        backgroundColor: getTensorColor(tensorId),
                    }}
                />
            )
        );
    };

    const generateTooltipContent = (node: Node) => {
        const tensorSquare = getTensorSquare(node.params.tensor_id);
        return (
            <>
                {tensorSquare}
                <strong>{formatOperationName(node)}</strong>
            </>
        );
    };

    const initializeGraph = useCallback(
        (container: HTMLDivElement | null) => {
            if (!container) {
                return;
            }

            const consumersByTensorId = new Map<number, number[]>();
            const producersByTensorId = new Map<number, number>();

            const ops = data
                .filter((op) => op.node_type === 'function_start')
                .map((op) => {
                    const inputTensors = op.inputs.filter((input) => input.node_type === 'tensor') || [];
                    const outputTensors = op.outputs.filter((output) => output.node_type === 'tensor') || [];

                    outputTensors.forEach((tensor) => {
                        const tid = Number(tensor.params.tensor_id);
                        producersByTensorId.set(tid, op.id);
                    });

                    inputTensors.forEach((tensor) => {
                        const tid = Number(tensor.params.tensor_id);
                        const existing = consumersByTensorId.get(tid) || [];
                        existing.push(op.id);
                        consumersByTensorId.set(tid, existing);
                    });

                    return { ...op, graphInputs: inputTensors, graphOutputs: outputTensors };
                });

            const nodeList = ops.map((node) => ({
                id: node.id,
                label: ` ${formatOperationName(node)}`,
                shape: 'box',
            }));

            const edgesArray: Edge[] = [];

            ops.forEach((consumer) => {
                consumer.graphInputs.forEach((tensor) => {
                    const tid = Number(tensor.params.tensor_id);
                    const producerId = producersByTensorId.get(tid);
                    if (producerId === undefined) {
                        return;
                    }

                    edgesArray.push({
                        id: `${producerId}->${consumer.id}#${tid}`,
                        from: producerId,
                        to: consumer.id,
                        label: `${toReadableShape(tensor.params.shape)}`,
                    });
                });
            });

            // dedupe works now
            const seen = new Set<string>();
            const dedupedEdges = edgesArray.filter((e) =>
                seen.has(String(e.id)) ? false : (seen.add(String(e.id)), true),
            );

            const edges = new DataSet(dedupedEdges);

            const ids = new Set<string>();
            edges.forEach(({ from, to }) => {
                ids.add(String(from));
                ids.add(String(to));
            });

            const nodes = new DataSet(nodeList.filter((op) => ids.has(String(op.id))));

            const networkData = { nodes, edges };

            const options = {
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
                    fixed: false,
                },
                edges: {
                    font: {
                        color: '#f5e2ba',
                        size: 18,
                        strokeColor: '#000',
                        smooth: { enabled: true, type: 'cubicBezier', roundness: 0.5 },
                        // align: 'middle',
                        // align: 'top',
                        physics: true,
                    },
                    color: '#f5e2ba',
                    smooth: false,
                    arrows: { to: { enabled: true, scaleFactor: 0.5 } },
                },
                autoResize: true,
                layout: {
                    hierarchical: {
                        enabled: true,
                        levelSeparation: 100,
                        nodeSpacing: 300,
                        treeSpacing: 300,
                        blockShifting: true,
                        edgeMinimization: false,
                        direction: 'UD',
                        sortMethod: 'directed',
                        shakeTowards: 'leaves',
                    },
                    improvedLayout: true,
                },
                interaction: {
                    dragNodes: true,
                    dragView: true,
                    zoomView: true,
                    zoomSpeed: 0.4,
                },
                physics: {
                    enabled: false,
                    solver: 'forceAtlas2Based',
                    forceAtlas2Based: {
                        gravitationalConstant: -30,
                        centralGravity: 0.01,
                        springLength: 100,
                        springConstant: 0.08,
                    },
                    stabilization: {
                        enabled: true,
                        iterations: 1000,
                    },
                },
            };

            networkRef.current = new Network(container, networkData, options);

            networkRef.current.on('blurNode', () => {
                if (tooltipRef.current) {
                    tooltipRef.current.classList.remove('visible');
                }
            });
            networkRef.current.on('dragStart', () => {
                if (tooltipRef.current) {
                    tooltipRef.current.classList.remove('visible');
                }
            });

            networkRef.current.on('click', (params) => {
                if (tooltipRef.current) {
                    tooltipRef.current.classList.remove('visible');
                }
                if (params.nodes.length > 0) {
                    const nodeId = params.nodes[0];
                    focusOnNode(nodeId);
                }
            });
        },
        [data, focusOnNode],
    );
    useEffect(() => {
        return () => {
            if (networkRef.current) {
                networkRef.current.destroy();
            }
        };
    }, []);

    return (
        <Overlay2
            isOpen={open}
            enforceFocus
            hasBackdrop
            usePortal
            canEscapeKeyClose
            transitionDuration={0}
            onClose={onClose}
            canOutsideClickClose
            portalClassName='tensor-visualisation-overlay'
        >
            <Card className='tensor-visualisation'>
                <div className='header'>
                    <h3 className='title'>
                        <Button
                            icon={IconNames.CROSS}
                            variant={ButtonVariant.MINIMAL}
                            size={Size.SMALL}
                            onClick={onClose}
                        />
                    </h3>
                </div>
                <div className='graph-component'>
                    <div
                        className='graph'
                        ref={initializeGraph}
                    />
                    <div
                        className='graph-tooltip'
                        ref={tooltipRef}
                    >
                        {tooltipContent}
                    </div>
                </div>
                <div>
                    <aside>
                        Scroll to zoom. Drag to pan. Click an edge to go to connecting node. Click node to see details.
                        Drag nodes horizontally.
                    </aside>
                </div>
            </Card>
        </Overlay2>
    );
};

export default GraphComponent;
