/* eslint-disable no-continue */
import React, { useCallback, useRef } from 'react';
import { Edge, Network, Node } from 'vis-network';
import { GraphBundle, GraphDocument } from '../../model/MLIRJsonModel';

interface MLIRViewProps {
    data: GraphBundle;
}
const MLIRView: React.FC<MLIRViewProps> = ({ data }) => {
    const networkRef = useRef<Network | null>(null);

    const getTensorInfoFromAttrs = (attrs: { key: string; value: string }[]) => {
        const shapeAttr =
            attrs.find((a) => a.key === 'shape') ||
            attrs.find((a) => a.key === 'tensor_shape') ||
            attrs.find((a) => a.key === 'dims');

        const dtypeAttr =
            attrs.find((a) => a.key === 'dtype') ||
            attrs.find((a) => a.key === 'element_type') ||
            attrs.find((a) => a.key === 'type');

        const shape = shapeAttr?.value;
        let dtype = dtypeAttr?.value;

        if (!dtype && shape?.includes('tensor<')) {
            const match = shape.match(/x([a-z0-9]+)>$/i);
            if (match) {
                // eslint-disable-next-line prefer-destructuring
                dtype = match[1];
            }
        }

        const cleanShape = (raw?: string) =>
            raw
                ?.replace(/^tensor</, '')
                ?.replace(/>$/, '')
                ?.replace(/x/g, '×');

        const prettyShape = cleanShape(shape);

        return {
            shape: prettyShape,
            dtype,
            label: prettyShape && dtype ? `${prettyShape} ${dtype}` : prettyShape || dtype,
        };
    };

    // const namespaceList = Array.from(new Set(data.graphs[0].nodes.map((n) => n.namespace)));

    const buildData = (graph: GraphDocument) => {
        const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

        const nodes: Node[] = graph.nodes.map((n) => ({
            id: n.id,
            label: `${n.label}\n${n.namespace}`,
            group: n.namespace, // .split('/').join(' '),
            // module: n.namespace,
            shape: 'box',
        }));

        const seen = new Set<string>();
        const edges: Edge[] = [];

        for (const target of graph.nodes) {
            for (const e of target.incomingEdges ?? []) {
                const key = `${e.sourceNodeId}:${e.sourceNodeOutputId}->${target.id}:${e.targetNodeInputId}`;
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);

                const sourceNode = nodeMap.get(e.sourceNodeId);

                let shapeLabel: string | undefined;

                if (sourceNode) {
                    const outputMeta = sourceNode.outputsMetadata?.find((m) => m.id === e.sourceNodeOutputId);

                    if (outputMeta) {
                        const parsedAttrs = getTensorInfoFromAttrs(outputMeta.attrs);

                        shapeLabel = parsedAttrs.label;
                    }
                }

                edges.push({
                    from: e.sourceNodeId,
                    to: target.id,
                    label: shapeLabel ? `${shapeLabel}` : `${e.sourceNodeOutputId}→${e.targetNodeInputId}`,
                });
            }
        }

        return { nodes, edges };
    };
    const { nodes, edges } = buildData(data.graphs[0]);

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

            // networkRef.current.on('click', (params) => {
            //     if (params.nodes.length > 0) {
            //         const nodeId = params.nodes[0];
            //         focusOnNode(nodeId);
            //         colorHighlightIO(nodeId);
            //     } else {
            //         networkRef.current?.selectNodes([], true);
            //     }
            // });
        },
        [edges, nodes],
    );

    // useEffect(() => {
    //     return () => {
    //         networkRef.current?.destroy();
    //     };
    // }, []);
    return (
        <div className='mlir-view'>
            <div className='graph-component'>
                <div
                    className='graph'
                    ref={initializeGraph}
                />
            </div>
            {/* <pre style={{ height: '200px', overflowY: 'scroll' }}>{JSON.stringify(data, null, 2)}</pre> */}
        </div>
    );
};

export default MLIRView;
