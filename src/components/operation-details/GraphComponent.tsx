import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DataSet, Network } from 'vis-network/standalone';
import { Edge } from 'vis-network';
import { Node } from '../../model/APIData';

const GraphComponent: React.FC<{ data: Node[] }> = ({ data }) => {
    const networkContainer = useRef<HTMLDivElement>(null);
    const networkRef = useRef<Network | null>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const [tooltipContent, setTooltipContent] = useState<string>('');

    const focusOnNode = useCallback(
        (nodeId: number | null) => {
            if (nodeId === null) {
                return;
            }
            if (networkRef.current) {
                networkRef.current.focus(nodeId, {
                    animation: { duration: 500, easingFunction: 'easeInOutCubic' },
                });
                networkRef.current.selectNodes([nodeId], true);

                const nodeData = data.find((node) => node.id === nodeId);
                if (nodeData && tooltipRef.current) {
                    let result = '';
                    for (const [key, value] of Object.entries(nodeData.params)) {
                        result += `<strong>${key}</strong>: ${value}<br />`;
                    }
                    setTooltipContent(
                        `<strong>${formatOperationName(nodeData)}</strong><br/>
${JSON.stringify(nodeData.params) !== '{}' ? `${result}` : ''}`,
                    );
                    tooltipRef.current.style.display = 'block';
                }
            }
        },
        [data],
    );

    const formatOperationName = (item: Node) => {
        const prefix = item.node_type === 'function_start' ? 'Start ' : '';
        const suffix = item.node_type === 'function_end' ? 'End' : '';
        return item.params.name ? `${prefix + item.params.name}() ${suffix}` : item.node_type;
    };

    useEffect(() => {
        const nodes = new DataSet(
            data.map((item) => ({
                id: item.id,
                label: formatOperationName(item),
                shape: 'box',
            })),
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
                    levelSeparation: 100,
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
                zoomSpeed: 0.5,
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

        if (networkContainer.current) {
            networkRef.current = new Network(networkContainer.current, networkData, options);

            networkRef.current.on('blurNode', () => {
                if (tooltipRef.current) {
                    tooltipRef.current.style.display = 'none';
                }
            });
            networkRef.current.on('dragStart', () => {
                if (tooltipRef.current) {
                    tooltipRef.current.style.display = 'none';
                }
            });

            networkRef.current.on('click', (params) => {
                if (tooltipRef.current) {
                    tooltipRef.current.style.display = 'none';
                }
                if (params.nodes.length > 0) {
                    const nodeId = params.nodes[0];
                    focusOnNode(nodeId);
                } else if (params.edges.length > 0) {
                    const edgeId = params.edges[0];
                    const edge = edges.find((e) => e.id === edgeId);
                    focusOnNode((edge?.to as number) || null);
                }
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data]);

    return (
        <div style={{ position: 'relative' }}>
            <div
                ref={networkContainer}
                style={{ height: '600px', width: '100%' }}
            />
            <div
                className='tooltip'
                ref={tooltipRef}
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: tooltipContent }}
                style={{
                    position: 'absolute',
                    display: 'none',
                    top: 0,
                    padding: '10px',
                    backgroundColor: 'white',
                    border: '1px solid #ccc',
                    borderRadius: '5px',
                    boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.2)',
                    pointerEvents: 'none',
                    zIndex: 10,
                    color: '#202020',
                }}
            />
        </div>
    );
};

export default GraphComponent;
