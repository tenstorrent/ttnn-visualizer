// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
    Background,
    Controls,
    MarkerType,
    MiniMap,
    ReactFlow,
    ReactFlowProvider,
    useEdgesState,
    useNodesState,
    useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { type MouseEvent as ReactMouseEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NodeRelation } from '../../definitions/NodeRelation';
import { toReadableShape } from '../../functions/formatting';
import type { OperationDescription } from '../../model/APIData';
import type { PerfOverlaySource } from '../../functions/perfOverlay';
import LoadingSpinner from '../LoadingSpinner';
import OpGraphEdge from './OpGraphEdge';
import OpGraphInfoPanel from './OpGraphInfoPanel';
import OpGraphNode from './OpGraphNode';
import { useOpGraphLayoutWorker } from './useOpGraphLayoutWorker';
import {
    type OpGraphBuildOptions,
    type OpGraphBuiltGraph,
    OpGraphEdgeType,
    type OpGraphFlowEdge,
    type OpGraphFlowNode,
    OpGraphNodeType,
    type OpGraphSourceOperation,
} from './opGraphTypes';
import 'styles/components/OperationGraphReactFlow.scss';

const NODE_TYPES = { [OpGraphNodeType.OP]: OpGraphNode };
const EDGE_TYPES = { [OpGraphEdgeType.OP]: OpGraphEdge };

const EDGE_MARKER = { type: MarkerType.ArrowClosed, width: 18, height: 18 } as const;

// vis clamped zoom-in at 3 and the graph is wide enough that fitting a large
// report needs to zoom far out.
const MAX_ZOOM = 3;
const MIN_ZOOM = 0.02;
const FOCUS_ZOOM = 1;
const FOCUS_DURATION_MS = 500;

// The toolbar that drives these lands with the rest of the controls; the
// defaults match what vis shipped, so the graph is usable in the meantime.
const BUILD_OPTIONS: OpGraphBuildOptions = { hideDeallocate: true, compact: false };

const SELECTED_NODE_CLASS = 'op-graph-node-selected';

const NODE_CLASS_BY_RELATION: Record<NodeRelation, string> = {
    [NodeRelation.Input]: 'op-graph-node-input',
    [NodeRelation.Output]: 'op-graph-node-output',
};

const EDGE_CLASS_BY_RELATION: Record<NodeRelation, string> = {
    [NodeRelation.Input]: 'op-graph-edge-input',
    [NodeRelation.Output]: 'op-graph-edge-output',
};

interface OperationGraphReactFlowProps {
    operationList: OperationDescription[];
    operationId?: number;
    // Consumed once the perf overlay is ported; declared so `GraphView` keeps
    // its existing call shape.
    perfRows?: PerfOverlaySource[];
    isPerfReportLoaded?: boolean;
}

const OperationGraphInner = ({ operationList, operationId }: OperationGraphReactFlowProps) => {
    const [nodes, setNodes, onNodesChange] = useNodesState<OpGraphFlowNode>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<OpGraphFlowEdge>([]);
    const [selectedOperationId, setSelectedOperationId] = useState<number | null>(operationId ?? null);
    const { setCenter, getNode } = useReactFlow<OpGraphFlowNode, OpGraphFlowEdge>();

    const selectedOperationIdRef = useRef(selectedOperationId);
    useEffect(() => {
        selectedOperationIdRef.current = selectedOperationId;
    }, [selectedOperationId]);

    // `getNode` reads the React Flow store, which is a tick behind `setNodes`,
    // so a focus requested while applying a build has to wait for the commit.
    const pendingFocusRef = useRef<number | null>(null);

    const sourceOperations = useMemo<OpGraphSourceOperation[]>(
        () =>
            operationList.map((operation) => ({
                id: operation.id,
                name: operation.name,
                fileIdentifier: operation.operationFileIdentifier,
                outputs: operation.outputs.map((tensor) => ({
                    edgeLabel: toReadableShape(tensor.shape),
                    consumers: tensor.consumers,
                })),
            })),
        [operationList],
    );

    const operationNamesById = useMemo(() => {
        const namesById = new Map<number, string>();
        for (const operation of operationList) {
            namesById.set(operation.id, operation.name);
        }
        return namesById;
    }, [operationList]);

    const onBuilt = useCallback(
        (graph: OpGraphBuiltGraph) => {
            setNodes(graph.nodes);
            setEdges(graph.edges.map((edge) => ({ ...edge, markerEnd: EDGE_MARKER })));

            // An op can drop out of the graph between builds — isolated, or
            // filtered as a deallocate — so selection falls back the way the vis
            // implementation did rather than pointing at nothing.
            const desired = selectedOperationIdRef.current;
            const isPresent = desired !== null && graph.nodes.some((node) => node.data.operationId === desired);
            const target = isPresent ? desired : (graph.nodes[0]?.data.operationId ?? null);
            if (target !== desired) {
                setSelectedOperationId(target);
            }
            pendingFocusRef.current = target;
        },
        [setNodes, setEdges],
    );

    const { runBuild, isBuilding } = useOpGraphLayoutWorker(sourceOperations, onBuilt);

    useEffect(() => {
        runBuild(BUILD_OPTIONS);
    }, [runBuild, sourceOperations]);

    const focusOperation = useCallback(
        (id: number) => {
            const node = getNode(String(id));
            if (!node) {
                return;
            }
            void setCenter(node.position.x + (node.width ?? 0) / 2, node.position.y + (node.height ?? 0) / 2, {
                zoom: FOCUS_ZOOM,
                duration: FOCUS_DURATION_MS,
            });
        },
        [getNode, setCenter],
    );

    useEffect(() => {
        const target = pendingFocusRef.current;
        if (target === null || nodes.length === 0) {
            return;
        }
        pendingFocusRef.current = null;
        focusOperation(target);
    }, [nodes, focusOperation]);

    const { edgesBySource, edgesByTarget } = useMemo(() => {
        const bySource = new Map<string, OpGraphFlowEdge[]>();
        const byTarget = new Map<string, OpGraphFlowEdge[]>();
        for (const edge of edges) {
            const outgoing = bySource.get(edge.source);
            if (outgoing) {
                outgoing.push(edge);
            } else {
                bySource.set(edge.source, [edge]);
            }
            const incoming = byTarget.get(edge.target);
            if (incoming) {
                incoming.push(edge);
            } else {
                byTarget.set(edge.target, [edge]);
            }
        }
        return { edgesBySource: bySource, edgesByTarget: byTarget };
    }, [edges]);

    const highlight = useMemo(() => {
        if (selectedOperationId === null) {
            return null;
        }
        const selectedId = String(selectedOperationId);
        const relationByNodeId = new Map<string, NodeRelation>();
        const relationByEdgeId = new Map<string, NodeRelation>();
        // Outputs first so that a neighbour on both sides of a cycle reads as an
        // input, which is the precedence the vis implementation used.
        for (const edge of edgesBySource.get(selectedId) ?? []) {
            relationByNodeId.set(edge.target, NodeRelation.Output);
            relationByEdgeId.set(edge.id, NodeRelation.Output);
        }
        for (const edge of edgesByTarget.get(selectedId) ?? []) {
            relationByNodeId.set(edge.source, NodeRelation.Input);
            relationByEdgeId.set(edge.id, NodeRelation.Input);
        }
        return { selectedId, relationByNodeId, relationByEdgeId };
    }, [selectedOperationId, edgesBySource, edgesByTarget]);

    const styledNodes = useMemo(() => {
        if (!highlight) {
            return nodes;
        }
        return nodes.map((node) => {
            if (node.id === highlight.selectedId) {
                return { ...node, className: SELECTED_NODE_CLASS };
            }
            const relation = highlight.relationByNodeId.get(node.id);
            return relation ? { ...node, className: NODE_CLASS_BY_RELATION[relation] } : node;
        });
    }, [nodes, highlight]);

    const styledEdges = useMemo(() => {
        if (!highlight) {
            return edges;
        }
        return edges.map((edge) => {
            const relation = highlight.relationByEdgeId.get(edge.id);
            return relation ? { ...edge, className: EDGE_CLASS_BY_RELATION[relation] } : edge;
        });
    }, [edges, highlight]);

    const handleNodeClick = useCallback(
        (_event: ReactMouseEvent, node: OpGraphFlowNode) => {
            setSelectedOperationId(node.data.operationId);
            focusOperation(node.data.operationId);
        },
        [focusOperation],
    );

    const handlePaneClick = useCallback(() => {
        setSelectedOperationId(null);
    }, []);

    // The panel covers the corner the minimap docks in, so the two are mutually
    // exclusive. Unmounting rather than hiding matters: the minimap draws a rect
    // per node and re-derives them on every node change.
    const isPanelOpen = selectedOperationId !== null && !isBuilding;

    return (
        <div className='operation-graph-react-flow'>
            {isBuilding ? (
                <div className='operation-graph-react-flow-loader'>
                    <LoadingSpinner />
                </div>
            ) : null}
            <ReactFlow<OpGraphFlowNode, OpGraphFlowEdge>
                nodes={styledNodes}
                edges={styledEdges}
                nodeTypes={NODE_TYPES}
                edgeTypes={EDGE_TYPES}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={handleNodeClick}
                onPaneClick={handlePaneClick}
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
                nodesConnectable={false}
                selectNodesOnDrag={false}
                proOptions={{ hideAttribution: true }}
            >
                <Background />
                <Controls />
                {!isPanelOpen ? <MiniMap pannable /> : null}
            </ReactFlow>
            {isPanelOpen ? (
                <OpGraphInfoPanel
                    operationId={selectedOperationId}
                    operationList={operationList}
                    operationNamesById={operationNamesById}
                    onLocateOperation={focusOperation}
                />
            ) : null}
        </div>
    );
};

const OperationGraphReactFlow = (props: OperationGraphReactFlowProps) => (
    <ReactFlowProvider>
        <OperationGraphInner {...props} />
    </ReactFlowProvider>
);

export default memo(OperationGraphReactFlow);
