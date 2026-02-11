// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useCallback, useEffect, useRef } from 'react';
import { Network } from 'vis-network/standalone';
import { DataSet } from 'vis-data';
import { Edge } from 'vis-network';
import { Button, ButtonVariant, Card, Overlay2, Size } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { Node } from '../../model/APIData';
import 'styles/components/DeviceOperationsGraphComponent.scss';
import { isExtendedDeviceOperation } from '../../functions/filterOperations';
import { toReadableShape } from '../../functions/formatting';

export interface GraphComponentProps {
    data: Node[];
    open: boolean;
    onClose: () => void;
}

type ConnectedDeviceOperation = Node & {
    inputs: Node[];
    outputs: Node[];
    graphInputs: Node[];
    graphOutputs: Node[];
};

const GraphComponent: React.FC<GraphComponentProps> = ({ data, open, onClose }) => {
    const networkRef = useRef<Network | null>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);

    const formatOperationName = (item: Node) => {
        return item.params.name ? `${item.params.name}()` : '';
    };

    const initializeGraph = useCallback(
        (container: HTMLDivElement | null) => {
            if (!container) {
                return;
            }

            const tensorShapeById = new Map<number, string>();

            const ops: ConnectedDeviceOperation[] = data
                .filter((op) => op.node_type === 'function_start')
                .map((op) => {
                    const inputTensors = op.inputs?.filter((i) => i.node_type === 'tensor') ?? [];
                    const outputTensors = op.outputs?.filter((o) => o.node_type === 'tensor') ?? [];
                    return { ...op, graphInputs: inputTensors, graphOutputs: outputTensors };
                });

            const displayedOps = ops.filter((op) => isExtendedDeviceOperation(op.params.name));
            const displayedIds = new Set(displayedOps.map((o) => o.id));

            const producersByTensorId = new Map<number, number[]>();
            const consumersByTensorId = new Map<number, number[]>();

            for (const op of ops) {
                for (const tensor of op.graphOutputs) {
                    const tensorId = Number(tensor.params.tensor_id);
                    if (tensor.params.shape) {
                        if (!tensorShapeById.has(tensorId)) {
                            tensorShapeById.set(tensorId, tensor.params.shape);
                        }
                    }
                    const arr = producersByTensorId.get(tensorId) ?? [];
                    arr.push(op.id);
                    producersByTensorId.set(tensorId, arr);
                }
                for (const tensor of op.graphInputs) {
                    const tensorId = Number(tensor.params.tensor_id);
                    if (tensor.params.shape) {
                        if (!tensorShapeById.has(tensorId)) {
                            tensorShapeById.set(tensorId, tensor.params.shape);
                        }
                    }
                    const arr = consumersByTensorId.get(tensorId) ?? [];
                    arr.push(op.id);
                    consumersByTensorId.set(tensorId, arr);
                }
            }

            const edgesByProducer = new Map<number, Array<{ to: number; tid: number; shape?: string }>>();

            for (const [tid, producers] of producersByTensorId.entries()) {
                const consumers = consumersByTensorId.get(tid) ?? [];
                for (const from of producers) {
                    for (const to of consumers) {
                        if (from === to) {
                            // eslint-disable-next-line no-continue
                            continue;
                        }
                        const arr = edgesByProducer.get(from) ?? [];
                        arr.push({ to, tid });
                        edgesByProducer.set(from, arr);
                    }
                }
            }

            function buildCompressedEdges(): Edge[] {
                const result: Edge[] = [];
                const seenEdge = new Set<string>();

                for (const start of displayedOps) {
                    const idToConnection: Array<{ id: number; via?: { tensorId: number } }> = [{ id: start.id }];
                    const visited = new Set<number>([start.id]);

                    while (idToConnection.length) {
                        const cur = idToConnection.shift()!;
                        const nexts = edgesByProducer.get(cur.id) ?? [];

                        for (const e of nexts) {
                            if (visited.has(e.to)) {
                                // eslint-disable-next-line no-continue
                                continue;
                            }
                            visited.add(e.to);

                            const via = cur.via ?? { tensorId: e.tid };

                            if (displayedIds.has(e.to) && e.to !== start.id) {
                                const edgeId = `${start.id}->${e.to}#${via.tensorId}`;
                                const shape = tensorShapeById.get(via.tensorId);
                                const label = shape ? toReadableShape(shape) : `T${via.tensorId}`;
                                if (!seenEdge.has(edgeId)) {
                                    seenEdge.add(edgeId);
                                    result.push({
                                        id: edgeId,
                                        from: start.id,
                                        to: e.to,
                                        label,
                                    });
                                }
                                // eslint-disable-next-line no-continue
                                continue;
                            }

                            idToConnection.push({ id: e.to, via });
                        }
                    }
                }

                return result;
            }

            const edges = new DataSet(buildCompressedEdges());
            const nodes = new DataSet(
                displayedOps.map((op) => ({ id: op.id, label: ` ${formatOperationName(op)}`, shape: 'box' })),
            );

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
                    color: '#f5e2ba',
                    arrows: { to: { enabled: true, scaleFactor: 0.5 } },

                    font: {
                        color: '#f5e2ba',
                        size: 14,
                        strokeColor: '#000',
                    },
                    smooth: {
                        enabled: true,
                        type: 'cubicBezier',
                        // forceDirection: 'vertical',
                        roundness: 0.35,
                    },
                    width: 1,
                    selectionWidth: 2,
                    hoverWidth: 2,
                },

                autoResize: true,

                layout: {
                    hierarchical: {
                        enabled: true,
                        direction: 'UD',
                        sortMethod: 'directed',
                        levelSeparation: 160,
                        nodeSpacing: 220,
                        treeSpacing: 220,
                        blockShifting: true,
                        edgeMinimization: true,
                        shakeTowards: 'leaves',
                        parentCentralization: true,
                    },
                    improvedLayout: true,
                },

                interaction: {
                    dragNodes: true,
                    dragView: true,
                    zoomView: true,
                    zoomSpeed: 0.4,
                    hover: true,
                },

                physics: {
                    enabled: false,
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
        },
        [data],
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
                    />
                </div>
                <div>
                    <aside>Scroll to zoom. Drag to pan. Drag nodes horizontally.</aside>
                </div>
            </Card>
        </Overlay2>
    );
};

export default GraphComponent;
