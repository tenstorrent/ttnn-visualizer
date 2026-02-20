// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

/* eslint-disable no-continue */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Network } from 'vis-network/standalone';
import { DataSet } from 'vis-data';
import { Edge, IdType } from 'vis-network';
import { Button, ButtonVariant, Card, Overlay2, Size } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { Node } from '../../model/APIData';
import 'styles/components/DeviceOperationsGraphComponent.scss';
import { isExtendedDeviceOperation } from '../../functions/filterOperations';
import { toReadableShape } from '../../functions/formatting';
import { GRAPH_COLORS } from '../../definitions/GraphColors';

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

const formatOperationName = (item: Node) => {
    return item.params.name ? `${item.params.name}()` : '';
};

function removeRedundantEdgesViaIntermediateNodes(edges: Edge[]): Edge[] {
    const outgoing = new Map<number, Edge[]>();
    for (const e of edges) {
        const from = Number(e.from);
        const arr = outgoing.get(from) ?? [];
        arr.push(e);
        outgoing.set(from, arr);
    }

    const canReachWithIntermediate = (from: number, to: number, skipEdgeId: IdType | undefined): boolean => {
        const nodesWithDepth: Array<{ node: number; depth: number }> = [];
        const visited = new Set<number>([from]);

        for (const edge of outgoing.get(from) ?? []) {
            if (edge.id === skipEdgeId) {
                continue;
            }
            const next = Number(edge.to);

            if (next === to) {
                continue;
            }

            if (!visited.has(next)) {
                visited.add(next);
                nodesWithDepth.push({ node: next, depth: 1 });
            }
        }

        while (nodesWithDepth.length) {
            const pointer = nodesWithDepth.shift()!;
            const nextEdges = outgoing.get(pointer.node) ?? [];
            for (const e of nextEdges) {
                if (e.id === skipEdgeId) {
                    continue;
                }
                const next = Number(e.to);

                if (next === to) {
                    if (pointer.depth + 1 >= 2) {
                        return true;
                    }
                }

                if (!visited.has(next)) {
                    visited.add(next);
                    nodesWithDepth.push({ node: next, depth: pointer.depth + 1 });
                }
            }
        }

        return false;
    };

    return edges.filter((e) => {
        const from = Number(e.from);
        const to = Number(e.to);
        return !canReachWithIntermediate(from, to, e.id);
    });
}

const GraphComponent: React.FC<GraphComponentProps> = ({ data, open, onClose }) => {
    const networkRef = useRef<Network | null>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);

    const ops: ConnectedDeviceOperation[] = useMemo(() => {
        return (data ?? [])
            .filter((op) => op.node_type === 'function_start')
            .map((op) => {
                const inputTensors = op.inputs?.filter((i) => i.node_type === 'tensor') ?? [];
                const outputTensors = op.outputs?.filter((o) => o.node_type === 'tensor') ?? [];
                return { ...op, graphInputs: inputTensors, graphOutputs: outputTensors } as ConnectedDeviceOperation;
            });
    }, [data]);

    const displayedOps = useMemo(() => ops.filter((op) => isExtendedDeviceOperation(op.params.name)), [ops]);
    const displayedIds = useMemo(() => new Set(displayedOps.map((o) => o.id)), [displayedOps]);

    const { edgesByProducer, tensorShapeById } = useMemo(() => {
        const tensorShapeByIdLocal = new Map<number, string>();
        const producersByTensorId = new Map<number, number[]>();
        const consumersByTensorId = new Map<number, number[]>();

        for (const op of ops) {
            for (const tensor of op.graphOutputs) {
                const tensorId = Number(tensor.params.tensor_id);
                if (tensor.params.shape && !tensorShapeByIdLocal.has(tensorId)) {
                    tensorShapeByIdLocal.set(tensorId, tensor.params.shape);
                }
                const idList = producersByTensorId.get(tensorId) ?? [];
                idList.push(op.id);
                producersByTensorId.set(tensorId, idList);
            }

            for (const tensor of op.graphInputs) {
                const tensorId = Number(tensor.params.tensor_id);
                if (tensor.params.shape && !tensorShapeByIdLocal.has(tensorId)) {
                    tensorShapeByIdLocal.set(tensorId, tensor.params.shape);
                }
                const idList = consumersByTensorId.get(tensorId) ?? [];
                idList.push(op.id);
                consumersByTensorId.set(tensorId, idList);
            }
        }

        const edgesByProducerLocal = new Map<number, Array<{ to: number; tid: number }>>();
        for (const [tid, producers] of producersByTensorId.entries()) {
            const consumers = consumersByTensorId.get(tid) ?? [];
            for (const from of producers) {
                for (const to of consumers) {
                    if (from === to) {
                        continue;
                    }
                    const connectionList = edgesByProducerLocal.get(from) ?? [];
                    connectionList.push({ to, tid });
                    edgesByProducerLocal.set(from, connectionList);
                }
            }
        }

        return { edgesByProducer: edgesByProducerLocal, tensorShapeById: tensorShapeByIdLocal };
    }, [ops]);

    const buildCompressedEdges = useCallback((): Edge[] => {
        const result: Edge[] = [];
        const seenEdge = new Set<string>();

        for (const start of displayedOps) {
            const q: Array<{ id: number; via?: { tensorId: number } }> = [{ id: start.id }];

            const visited = new Set<string>([`${start.id}#_`]);

            while (q.length) {
                const cur = q.shift()!;
                const nexts = edgesByProducer.get(cur.id) ?? [];

                for (const e of nexts) {
                    const via = cur.via ?? { tensorId: e.tid };
                    const visitKey = `${e.to}#${via.tensorId}`;
                    if (visited.has(visitKey)) {
                        continue;
                    }
                    visited.add(visitKey);

                    if (displayedIds.has(e.to) && e.to !== start.id) {
                        const edgeId = `${start.id}->${e.to}#${via.tensorId}`;

                        if (!seenEdge.has(edgeId)) {
                            seenEdge.add(edgeId);

                            const shape = tensorShapeById.get(via.tensorId);
                            const label = shape ? `T${via.tensorId} ${toReadableShape(shape)}` : `T${via.tensorId}`;

                            result.push({
                                id: edgeId,
                                from: start.id,
                                to: e.to,
                                label,
                                color: GRAPH_COLORS.normal,
                            });
                        }
                        continue;
                    }

                    q.push({ id: e.to, via });
                }
            }
        }

        return removeRedundantEdgesViaIntermediateNodes(result);
    }, [displayedOps, displayedIds, edgesByProducer, tensorShapeById]);

    const edges = useMemo(() => {
        return new DataSet(buildCompressedEdges());
    }, [buildCompressedEdges]);

    const nodes = useMemo(() => {
        return new DataSet(
            displayedOps.map((op) => ({ id: op.id, label: ` ${formatOperationName(op)}`, shape: 'box' })),
        );
    }, [displayedOps]);

    const colorHighlightIO = useCallback(
        (selectedNodeId: IdType) => {
            const allNodes = nodes.get();
            const allEdges = edges.get();

            const inputNodeIds = new Set<IdType | undefined>();
            const outputNodeIds = new Set<IdType | undefined>();
            const inputEdgeIds = new Set<IdType>();
            const outputEdgeIds = new Set<IdType>();

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
                        return { id: node.id, color: { background: GRAPH_COLORS.inputNode } };
                    }
                    if (outputNodeIds.has(node.id)) {
                        return { id: node.id, color: { background: GRAPH_COLORS.outputNode } };
                    }
                    return { id: node.id, color: { background: GRAPH_COLORS.normal } };
                }),
            );

            const edgesToUpdate = allEdges
                .map((edge) => {
                    if (inputEdgeIds.has(edge.id)) {
                        return { id: edge.id, color: GRAPH_COLORS.inputEdge };
                    }
                    if (outputEdgeIds.has(edge.id)) {
                        return { id: edge.id, color: GRAPH_COLORS.outputEdge };
                    }
                    if (edge.color !== GRAPH_COLORS.normal) {
                        return { id: edge.id, color: GRAPH_COLORS.normal };
                    }
                    return null;
                })
                .filter(Boolean) as Array<{ id: IdType; color: string }>;

            edges.update(edgesToUpdate);
        },
        [nodes, edges],
    );

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
                    // tooltipRef.current.classList.add('visible');
                }
            }
        },
        [data],
    );

    const initializeGraph = useCallback(
        (container: HTMLDivElement | null) => {
            if (!container) {
                return;
            }

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
                    font: { color: '#f5e2ba', size: 14, strokeColor: '#000' },
                    smooth: { enabled: true, type: 'cubicBezier', roundness: 0.35 },
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

                physics: { enabled: false },
            };

            networkRef.current = new Network(container, networkData, options);

            networkRef.current.on('blurNode', () => {
                tooltipRef.current?.classList.remove('visible');
            });

            networkRef.current.on('dragStart', () => {
                tooltipRef.current?.classList.remove('visible');
            });

            networkRef.current.on('click', (params) => {
                if (params.nodes.length > 0) {
                    const nodeId = params.nodes[0];
                    focusOnNode(nodeId);
                    colorHighlightIO(nodeId);
                } else {
                    networkRef.current?.selectNodes([], true);
                }
            });
        },
        [colorHighlightIO, edges, focusOnNode, nodes],
    );

    useEffect(() => {
        return () => {
            networkRef.current?.destroy();
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
