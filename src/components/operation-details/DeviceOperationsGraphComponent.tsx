// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DataSet, Network } from 'vis-network/standalone';
import { Edge } from 'vis-network';
import { Button, Card, Overlay2 } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { Node, NodeType } from '../../model/APIData';
import { getTensorColor } from '../../functions/colorGenerator';
import 'styles/components/DeviceOperationsGraphComponent.scss';

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
        const prefix = item.node_type === 'function_start' ? 'Start ' : '';
        const suffix = item.node_type === 'function_end' ? 'end' : '';
        return item.params.name ? `${prefix + item.params.name}() ${suffix}` : item.node_type;
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
        const result = Object.entries(node.params).map(([key, value]) => (
            <div key={key}>
                <strong>{key}:</strong> {value}
                <br />
            </div>
        ));
        return (
            <>
                ID: {node.id}
                {tensorSquare}
                <strong>{formatOperationName(node)}</strong>
                <br />
                {result.map((item) => item)}
            </>
        );
    };

    const initializeGraph = useCallback(
        (container: HTMLDivElement | null) => {
            if (!container) {
                return;
            }
            const deviceOpList: Node[] = [];
            const nodes = new DataSet(
                data.map((node) => {
                    // keeping the level implementation just in case, we may want to add a toggle
                    if (node.node_type === NodeType.function_start) {
                        deviceOpList.push(node);
                    }
                    if (node.node_type === NodeType.function_end) {
                        deviceOpList.pop();
                    }

                    return {
                        id: node.id,
                        label: `${node.id} ${formatOperationName(node)}`,
                        shape: 'box',
                        // level,
                    };
                }),
            );

            const edges: Edge[] = data.flatMap((item) =>
                item.connections.map((connection) => ({
                    from: item.id,
                    to: connection,
                })),
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
                },
                edges: {
                    font: { color: '#f5e2ba', size: 20, strokeColor: '#000' },
                    color: '#f5e2ba',
                    arrows: { to: { enabled: true, scaleFactor: 1 } },
                },
                autoResize: true,
                layout: {
                    hierarchical: {
                        enabled: true,
                        levelSeparation: 200,
                        nodeSpacing: 300,
                        treeSpacing: 1,
                        blockShifting: true,
                        edgeMinimization: true,
                        direction: 'UD',
                        sortMethod: 'hubsize',
                        shakeTowards: 'roots',
                    },
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
                } else if (params.edges.length > 0) {
                    const edgeId = params.edges[0];
                    const edge = edges.find((e) => e.id === edgeId);
                    focusOnNode((edge?.to as number) || null, true);
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
                            variant='minimal'
                            size='small'
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
