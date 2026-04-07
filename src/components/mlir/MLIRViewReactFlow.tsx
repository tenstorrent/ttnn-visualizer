/* eslint-disable no-continue */
/* eslint-disable no-void */

import React, { type MouseEvent, useCallback, useEffect, useMemo, useState } from 'react';
import 'styles/components/MLIRViewReactFlow.scss';
import ReactFlow, {
    Background,
    ConnectionLineType,
    Controls,
    Edge,
    Handle,
    MarkerType,
    MiniMap,
    Node,
    NodeProps,
    Position,
    ReactFlowProvider,
    useEdgesState,
    useNodesState,
    useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';

import ELK, { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk.bundled';
import { Button } from '@blueprintjs/core';
import { GraphBundle } from '../../model/MLIRJsonModel';

type MLNodeData = {
    label: string;
    kind?: 'op' | 'group';
    namespace: string;
    /** Present on outer op nodes when the subgraph is collapsed — click to expand. */
    collapsedSubgraphNamespace?: string;
};

interface ViewProps {
    data: GraphBundle;
}

const MlirOpNode: React.FC<NodeProps<MLNodeData>> = ({ data }) => (
    <>
        <Handle
            type='target'
            position={Position.Top}
            isConnectable={false}
        />
        {data.collapsedSubgraphNamespace ? (
            <span
                className='mlir-op-node-collapse-hint'
                title='Subgraph collapsed — click to expand'
            >
                ▸
            </span>
        ) : null}
        <div className='mlir-op-node-label'>{data.label}</div>
        {/* DEBUG LABEL */}
        {/* <div className='mlir-op-node-id nodrag nopan'>{id}</div> */}
        <Handle
            type='source'
            position={Position.Bottom}
            isConnectable={false}
        />
    </>
);

const elk = new ELK();

const elkOptions: Record<string, string> = {
    'elk.algorithm': 'layered',
    'elk.direction': 'DOWN',
    'elk.spacing.nodeNode': '40',
    'elk.layered.spacing.nodeNodeBetweenLayers': '120',
    'elk.spacing.edgeNode': '16',
    'elk.spacing.edgeEdge': '12',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.layered.crossingMinimization.semiInteractive': 'false',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.layered.thoroughness': '10',
    'elk.layered.unnecessaryBendpoints': 'true',
    'elk.layered.mergeEdges': 'false',
    'elk.layered.cycleBreaking.strategy': 'GREEDY',
};

const GROUP_MIN_WIDTH = 260;
const GROUP_MIN_HEIGHT = 140;
const GROUP_PADDING_X = 24;
const GROUP_PADDING_TOP = 36;
const GROUP_PADDING_BOTTOM = 20;

/** Match ELK spacing to rendered default-node size so layers do not overlap. */
function estimateOpNodeDimensions(label: string): { width: number; height: number } {
    const charW = 7.25;
    const padX = 32;
    const minW = 108;
    const maxW = 560;
    const width = Math.ceil(Math.min(maxW, Math.max(minW, label.length * charW + padX)));
    return { width, height: 30 };
}

function getNodeLayoutSize(n: Node<MLNodeData>): { width: number; height: number } {
    const style = n.style as { width?: number; height?: number } | undefined;
    const w = n.width ?? style?.width;
    const h = n.height ?? style?.height;
    const width = typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 180;
    const height = typeof h === 'number' && Number.isFinite(h) && h > 0 ? h : 48;
    return { width, height };
}

function toElkGraph(nodes: Node<MLNodeData>[], edges: Edge[]): ElkNode {
    return {
        id: 'root',
        layoutOptions: elkOptions,
        children: nodes.map((n) => {
            const { width, height } = getNodeLayoutSize(n);
            return {
                id: n.id,
                width,
                height,
            };
        }),
        edges: edges.map((e) => ({
            id: e.id,
            sources: [e.source],
            targets: [e.target],
        })) as ElkExtendedEdge[],
    };
}

async function layoutWithElk(
    nodes: Node<MLNodeData>[],
    edges: Edge[],
): Promise<{ nodes: Node<MLNodeData>[]; edges: Edge[] }> {
    if (nodes.length === 0) {
        return { nodes, edges };
    }

    const graph = toElkGraph(nodes, edges);
    const laidOut = await elk.layout(graph);

    const positions = new Map<string, { x: number; y: number }>();
    (laidOut.children ?? []).forEach((c) => {
        positions.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
    });

    return {
        nodes: nodes.map((n) => ({
            ...n,
            position: positions.get(n.id) ?? { x: 0, y: 0 },
        })),
        edges,
    };
}

const getNamespaceSegments = (namespace?: string): string[] => (namespace ? namespace.split('/').filter(Boolean) : []);

const getShortName = (namespace: string): string => {
    const parts = getNamespaceSegments(namespace);
    return parts[parts.length - 1] ?? namespace;
};

const getParentNamespace = (namespace: string): string | undefined => {
    const parts = getNamespaceSegments(namespace);
    if (parts.length <= 1) {
        return undefined;
    }
    return parts.slice(0, -1).join('/');
};

const getRegionBaseOpLabel = (namespace: string): string => getShortName(namespace).replace(/_\d+$/, '');

const isCollapsibleNamespace = (namespace: string, nodes: GraphBundle['graphs'][0]['nodes']): boolean => {
    const parentNamespace = getParentNamespace(namespace);
    if (!parentNamespace) {
        return false;
    }

    const expectedLabel = getRegionBaseOpLabel(namespace);
    const hasMatchingInnerOp = nodes.some((n) => n.namespace === namespace && n.label === expectedLabel);
    if (!hasMatchingInnerOp) {
        return false;
    }

    // Region namespaces usually have nested namespace segments (e.g. ".../Inputs").
    const hasNestedNamespaceContent = nodes.some((n) => {
        if (!n.namespace) {
            return false;
        }
        return n.namespace !== namespace && n.namespace.startsWith(`${namespace}/`);
    });
    if (hasNestedNamespaceContent) {
        return true;
    }

    // Fallback: if parent contains a matching op label, this namespace is likely a region body.
    const hasMatchingParentOp = nodes.some((n) => n.namespace === parentNamespace && n.label === expectedLabel);
    return hasMatchingParentOp;
};

const getNodeAttrValue = (node: GraphBundle['graphs'][0]['nodes'][number], key: string): string | undefined =>
    node.attrs.find((attr) => attr.key === key)?.value;

const getNamespaceOrdinal = (namespace: string): number => {
    const leaf = getShortName(namespace);
    const match = leaf.match(/_(\d+)$/);
    return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
};

const isNodeInsideNamespaceTree = (nodeNamespace: string | undefined, namespace: string): boolean => {
    if (!nodeNamespace) {
        return false;
    }
    return nodeNamespace === namespace || nodeNamespace.startsWith(`${namespace}/`);
};

function getTensorInfoFromAttrs(attrs: { key: string; value: string }[]) {
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
        label: prettyShape && dtype ? `${prettyShape} ${dtype}` : prettyShape || dtype,
    };
}

function getBounds(nodes: Node<MLNodeData>[]) {
    const minX = Math.min(...nodes.map((n) => n.position.x));
    const minY = Math.min(...nodes.map((n) => n.position.y));
    const maxX = Math.max(...nodes.map((n) => n.position.x + getNodeLayoutSize(n).width));
    const maxY = Math.max(...nodes.map((n) => n.position.y + getNodeLayoutSize(n).height));

    return { minX, minY, maxX, maxY };
}

const MlGraphInner: React.FC<ViewProps> = ({ data }) => {
    const { fitView } = useReactFlow();
    const graph = data.graphs[0];
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [hasFitInitially, setHasFitInitially] = useState(false);
    /** Subgraph namespaces currently expanded; default none = all collapsed. */
    const [expandedNamespaces, setExpandedNamespaces] = useState<Set<string>>(() => new Set());

    const nodeMap = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

    const collapsibleNamespaces = useMemo(
        () =>
            Array.from(new Set(graph.nodes.map((n) => n.namespace).filter(Boolean) as string[])).filter((namespace) =>
                isCollapsibleNamespace(namespace, graph.nodes),
            ),
        [graph.nodes],
    );

    const outerNamespaceByNodeId = useMemo(() => {
        const map = new Map<string, string>();
        const usedOuterNodeIds = new Set<string>();
        const nodeIndexById = new Map(graph.nodes.map((n, idx) => [n.id, idx]));
        const orderedNamespaces = [...collapsibleNamespaces].sort(
            (a, b) => getNamespaceOrdinal(a) - getNamespaceOrdinal(b),
        );

        for (const namespace of orderedNamespaces) {
            const parentNamespace = getParentNamespace(namespace);
            if (!parentNamespace) {
                continue;
            }
            const expectedLabel = getRegionBaseOpLabel(namespace);
            const namespaceNodes = graph.nodes.filter((n) => n.namespace === namespace);
            const preferredLocations = new Set(
                namespaceNodes
                    .filter((n) => n.label === expectedLabel)
                    .map((n) => getNodeAttrValue(n, 'full_location'))
                    .filter((v): v is string => Boolean(v)),
            );

            const outerCandidates = graph.nodes.filter(
                (n) => n.namespace === parentNamespace && n.label === expectedLabel && !usedOuterNodeIds.has(n.id),
            );
            outerCandidates.sort((a, b) => (nodeIndexById.get(a.id) ?? 0) - (nodeIndexById.get(b.id) ?? 0));

            const outer =
                outerCandidates.find((candidate) => {
                    const location = getNodeAttrValue(candidate, 'full_location');
                    return location ? preferredLocations.has(location) : false;
                }) ?? outerCandidates[0];

            if (outer) {
                map.set(outer.id, namespace);
                usedOuterNodeIds.add(outer.id);
            }
        }

        return map;
    }, [collapsibleNamespaces, graph.nodes]);

    /** Subgraph regions inferred from data; each has an internal anchor op we can collapse to. */
    const subgraphNamespaces = useMemo(() => {
        return [...collapsibleNamespaces].sort((a, b) => {
            const ord = getNamespaceOrdinal(a) - getNamespaceOrdinal(b);
            if (ord !== 0) {
                return ord;
            }
            return a.localeCompare(b);
        });
    }, [collapsibleNamespaces]);

    const namespaceAnchorNodeByNamespace = useMemo(() => {
        const map = new Map<string, string>();
        const nodeIndexById = new Map(graph.nodes.map((n, idx) => [n.id, idx]));
        for (const namespace of subgraphNamespaces) {
            const expectedLabel = getRegionBaseOpLabel(namespace);
            const candidates = graph.nodes.filter((n) => n.namespace === namespace && n.label === expectedLabel);
            candidates.sort((a, b) => {
                const aPinned = a.config?.pinToGroupTop ? 1 : 0;
                const bPinned = b.config?.pinToGroupTop ? 1 : 0;
                if (aPinned !== bPinned) {
                    return bPinned - aPinned;
                }
                return (nodeIndexById.get(a.id) ?? 0) - (nodeIndexById.get(b.id) ?? 0);
            });
            const anchor = candidates[0];
            if (anchor) {
                map.set(namespace, anchor.id);
            }
        }
        return map;
    }, [graph.nodes, subgraphNamespaces]);

    const anchorNamespaceByNodeId = useMemo(() => {
        const map = new Map<string, string>();
        namespaceAnchorNodeByNamespace.forEach((nodeId, namespace) => {
            map.set(nodeId, namespace);
        });
        return map;
    }, [namespaceAnchorNodeByNamespace]);

    const namespaceInputNodeIdsByNamespace = useMemo(() => {
        const map = new Map<string, string[]>();
        const nodeIndexById = new Map(graph.nodes.map((n, idx) => [n.id, idx]));

        for (const namespace of subgraphNamespaces) {
            const inputNodes = graph.nodes.filter((n) => {
                if (!isNodeInsideNamespaceTree(n.namespace, namespace)) {
                    return false;
                }
                if ((n.incomingEdges ?? []).length > 0) {
                    return false;
                }
                if (n.namespace?.startsWith(`${namespace}/Inputs`)) {
                    return true;
                }
                return /^%arg\d+$/i.test(n.label);
            });

            inputNodes.sort((a, b) => {
                const aMatch = a.label.match(/^%arg(\d+)$/i);
                const bMatch = b.label.match(/^%arg(\d+)$/i);
                const aIdx = aMatch ? Number(aMatch[1]) : Number.POSITIVE_INFINITY;
                const bIdx = bMatch ? Number(bMatch[1]) : Number.POSITIVE_INFINITY;
                if (aIdx !== bIdx) {
                    return aIdx - bIdx;
                }
                return (nodeIndexById.get(a.id) ?? 0) - (nodeIndexById.get(b.id) ?? 0);
            });

            map.set(
                namespace,
                inputNodes.map((n) => n.id),
            );
        }

        return map;
    }, [graph.nodes, subgraphNamespaces]);

    useEffect(() => {
        setHasFitInitially(false);
        setExpandedNamespaces(new Set());
    }, [graph.id]);

    const buildVisibleGraph = useCallback(async () => {
        const groupNodesForTopLayout: Node<MLNodeData>[] = [];
        const childNodesByNamespace = new Map<string, Node<MLNodeData>[]>();
        const internalEdgesByNamespace = new Map<string, Edge[]>();

        for (const namespace of subgraphNamespaces) {
            if (!expandedNamespaces.has(namespace)) {
                continue;
            }
            const childRawNodes = graph.nodes.filter((n) => isNodeInsideNamespaceTree(n.namespace, namespace));

            const childNodes: Node<MLNodeData>[] = childRawNodes.map((n) => {
                const { width, height } = estimateOpNodeDimensions(n.label);
                return {
                    id: n.id,
                    data: {
                        label: n.label,
                        kind: 'op',
                        namespace: n.namespace,
                    },
                    type: 'mlirOp',
                    position: { x: 0, y: 0 },
                    width,
                    height,
                    style: {
                        color: '#222',
                        background: '#f5f5f5',
                        border: '1px solid #999',
                        borderRadius: 6,
                        fontSize: 12,
                        width,
                        height,
                        boxSizing: 'border-box',
                    },
                };
            });

            const internalEdgesSeen = new Set<string>();
            const internalEdges: Edge[] = [];

            for (const target of childRawNodes) {
                for (const incoming of target.incomingEdges ?? []) {
                    const sourceRawNode = nodeMap.get(incoming.sourceNodeId);
                    if (!isNodeInsideNamespaceTree(sourceRawNode?.namespace, namespace)) {
                        continue;
                    }

                    const edgeId = `internal:${incoming.sourceNodeId}->${target.id}:${incoming.targetNodeInputId}`;
                    if (internalEdgesSeen.has(edgeId)) {
                        continue;
                    }
                    internalEdgesSeen.add(edgeId);

                    const sourceOutputMeta = sourceRawNode?.outputsMetadata?.find(
                        (m) => m.id === incoming.sourceNodeOutputId,
                    );
                    const edgeLabel = sourceOutputMeta
                        ? getTensorInfoFromAttrs(sourceOutputMeta.attrs).label
                        : undefined;

                    internalEdges.push({
                        id: edgeId,
                        source: incoming.sourceNodeId,
                        target: target.id,
                        sourceHandle: incoming.sourceNodeOutputId,
                        targetHandle: incoming.targetNodeInputId,
                        label: edgeLabel || `${incoming.sourceNodeOutputId}→${incoming.targetNodeInputId}`,
                        markerEnd: { type: MarkerType.ArrowClosed, height: 20, width: 20 },
                    });
                }
            }

            // eslint-disable-next-line no-await-in-loop
            const { nodes: laidOutChildren } = await layoutWithElk(childNodes, internalEdges);
            const bounds = laidOutChildren.length > 0 ? getBounds(laidOutChildren) : undefined;

            const groupWidth = bounds
                ? Math.max(GROUP_MIN_WIDTH, bounds.maxX - bounds.minX + GROUP_PADDING_X * 2)
                : GROUP_MIN_WIDTH;
            const groupHeight = bounds
                ? Math.max(GROUP_MIN_HEIGHT, bounds.maxY - bounds.minY + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM)
                : GROUP_MIN_HEIGHT;

            const normalizedChildren = laidOutChildren.map((child) => ({
                ...child,
                parentId: `group:${namespace}`,
                extent: 'parent' as const,
                draggable: false,
                position: bounds
                    ? {
                          x: child.position.x - bounds.minX + GROUP_PADDING_X,
                          y: child.position.y - bounds.minY + GROUP_PADDING_TOP,
                      }
                    : {
                          x: GROUP_PADDING_X,
                          y: GROUP_PADDING_TOP,
                      },
            }));

            childNodesByNamespace.set(namespace, normalizedChildren);
            internalEdgesByNamespace.set(namespace, internalEdges);

            groupNodesForTopLayout.push({
                id: `group:${namespace}`,
                type: 'group',
                data: {
                    label: `▾ ${getShortName(namespace)} · click to collapse`,
                    kind: 'group',
                    namespace,
                },
                position: { x: 0, y: 0 },
                style: {
                    width: groupWidth,
                    height: groupHeight,
                    border: '2px dashed #7d7d7d',
                    borderRadius: 16,
                    background: 'rgba(90, 90, 90, 0.14)',
                    color: '#ddd',
                    padding: '10px 12px',
                },
            });
        }

        const getContainingNamespace = (namespace?: string): string | undefined => {
            if (!namespace) {
                return undefined;
            }

            return [...subgraphNamespaces]
                .sort((a, b) => b.length - a.length)
                .find((candidate) => isNodeInsideNamespaceTree(namespace, candidate));
        };

        const topLevelOpNodes: Node<MLNodeData>[] = graph.nodes
            .filter((n) => {
                if (!n.namespace) {
                    return true;
                }

                const collapsedNamespace = anchorNamespaceByNodeId.get(n.id) ?? outerNamespaceByNodeId.get(n.id);
                if (collapsedNamespace) {
                    const ns = collapsedNamespace;
                    return !expandedNamespaces.has(ns);
                }

                const containingNamespace = getContainingNamespace(n.namespace);
                if (containingNamespace) {
                    return false;
                }

                return true;
            })
            .map((n) => {
                const { width, height } = estimateOpNodeDimensions(n.label);
                const collapsedNs = anchorNamespaceByNodeId.get(n.id) ?? outerNamespaceByNodeId.get(n.id);
                return {
                    id: n.id,
                    data: {
                        label: n.label,
                        kind: 'op',
                        namespace: n.namespace,
                        ...(collapsedNs ? { collapsedSubgraphNamespace: collapsedNs } : {}),
                    },
                    type: 'mlirOp',
                    position: { x: 0, y: 0 },
                    width,
                    height,
                    style: {
                        color: '#222',
                        background: '#f5f5f5',
                        border: '1px solid #999',
                        borderRadius: 6,
                        fontSize: 12,
                        width,
                        height,
                        boxSizing: 'border-box',
                    },
                };
            });

        const topLevelNodes = [...groupNodesForTopLayout, ...topLevelOpNodes];

        const mapToTopLevelEndpointId = (nodeId: string): string => {
            const collapsedNamespace = anchorNamespaceByNodeId.get(nodeId) ?? outerNamespaceByNodeId.get(nodeId);
            if (collapsedNamespace) {
                if (expandedNamespaces.has(collapsedNamespace)) {
                    return `group:${collapsedNamespace}`;
                }
                return nodeId;
            }

            const rawNode = nodeMap.get(nodeId);
            const containingNamespace = getContainingNamespace(rawNode?.namespace);
            if (containingNamespace) {
                if (expandedNamespaces.has(containingNamespace)) {
                    return `group:${containingNamespace}`;
                }
                return namespaceAnchorNodeByNamespace.get(containingNamespace) ?? nodeId;
            }

            return nodeId;
        };

        const mapToRenderedEndpointId = (nodeId: string): string => {
            const collapsedNamespace = anchorNamespaceByNodeId.get(nodeId) ?? outerNamespaceByNodeId.get(nodeId);
            if (collapsedNamespace) {
                if (expandedNamespaces.has(collapsedNamespace)) {
                    return namespaceAnchorNodeByNamespace.get(collapsedNamespace) ?? `group:${collapsedNamespace}`;
                }
                return nodeId;
            }

            const rawNode = nodeMap.get(nodeId);
            const containingNamespace = getContainingNamespace(rawNode?.namespace);
            if (containingNamespace) {
                if (expandedNamespaces.has(containingNamespace)) {
                    return namespaceAnchorNodeByNamespace.get(containingNamespace) ?? `group:${containingNamespace}`;
                }
                return namespaceAnchorNodeByNamespace.get(containingNamespace) ?? nodeId;
            }

            return nodeId;
        };

        const mapToRenderedTargetEndpointId = (
            sourceNodeId: string,
            targetNodeId: string,
            targetInputId?: string,
        ): string => {
            const sourceNamespace = getContainingNamespace(nodeMap.get(sourceNodeId)?.namespace);
            const targetNamespace = getContainingNamespace(nodeMap.get(targetNodeId)?.namespace);

            // Boundary entry: route external incoming edges to namespace input args (%arg*) when expanded.
            if (targetNamespace && expandedNamespaces.has(targetNamespace) && sourceNamespace !== targetNamespace) {
                const inputIdx = Number(targetInputId);
                if (Number.isInteger(inputIdx) && inputIdx >= 0) {
                    const inputNodeIds = namespaceInputNodeIdsByNamespace.get(targetNamespace) ?? [];
                    const inputNodeId = inputNodeIds[inputIdx];
                    if (inputNodeId) {
                        return inputNodeId;
                    }
                }
            }

            const collapsedNamespace =
                anchorNamespaceByNodeId.get(targetNodeId) ?? outerNamespaceByNodeId.get(targetNodeId);
            if (collapsedNamespace && expandedNamespaces.has(collapsedNamespace)) {
                const inputIdx = Number(targetInputId);
                if (Number.isInteger(inputIdx) && inputIdx >= 0) {
                    const inputNodeIds = namespaceInputNodeIdsByNamespace.get(collapsedNamespace) ?? [];
                    const inputNodeId = inputNodeIds[inputIdx];
                    if (inputNodeId) {
                        return inputNodeId;
                    }
                }
            }

            return mapToRenderedEndpointId(targetNodeId);
        };

        const mapTopLevelEndpointToRenderedEndpoint = (endpointId: string): string => {
            if (endpointId.startsWith('group:')) {
                const namespace = endpointId.slice('group:'.length);
                return namespaceAnchorNodeByNamespace.get(namespace) ?? endpointId;
            }
            return endpointId;
        };

        const topLevelEdgeSeen = new Set<string>();
        const topLevelEdgesForLayout: Edge[] = [];

        for (const target of graph.nodes) {
            for (const incoming of target.incomingEdges ?? []) {
                const sourceId = mapToTopLevelEndpointId(incoming.sourceNodeId);
                const targetId = mapToTopLevelEndpointId(target.id);

                if (sourceId === targetId) {
                    continue;
                }

                const edgeId = `layout:${sourceId}->${targetId}`;
                if (topLevelEdgeSeen.has(edgeId)) {
                    continue;
                }
                topLevelEdgeSeen.add(edgeId);

                topLevelEdgesForLayout.push({
                    id: edgeId,
                    source: sourceId,
                    target: targetId,
                });
            }
        }

        const topLevelNodeIdSet = new Set(topLevelNodes.map((n) => n.id));
        const topLevelEdgesForElk = topLevelEdgesForLayout.filter(
            (e) => topLevelNodeIdSet.has(e.source) && topLevelNodeIdSet.has(e.target),
        );

        const { nodes: laidOutTopLevelNodes } = await layoutWithElk(topLevelNodes, topLevelEdgesForElk);
        const topLevelNodeById = new Map<string, Node<MLNodeData>>(laidOutTopLevelNodes.map((n) => [n.id, n]));

        const finalNodes: Node<MLNodeData>[] = [];
        const finalEdges: Edge[] = [];
        const finalEdgeSeen = new Set<string>();
        const finalEdgePairSeen = new Set<string>();

        const addEdgeSafe = (edge: Edge) => {
            if (edge.source === edge.target) {
                return;
            }
            if (finalEdgeSeen.has(edge.id)) {
                return;
            }
            finalEdgeSeen.add(edge.id);
            finalEdgePairSeen.add(`${edge.source}->${edge.target}`);
            finalEdges.push(edge);
        };

        for (const node of topLevelOpNodes) {
            const laidOut = topLevelNodeById.get(node.id);
            finalNodes.push({
                ...node,
                position: laidOut?.position ?? node.position,
            });
        }

        for (const namespace of subgraphNamespaces) {
            if (!expandedNamespaces.has(namespace)) {
                continue;
            }
            const groupId = `group:${namespace}`;
            const laidOutGroup = topLevelNodeById.get(groupId);
            const topLayoutGroup = groupNodesForTopLayout.find((n) => n.id === groupId);

            finalNodes.push({
                ...(topLayoutGroup as Node<MLNodeData>),
                position: laidOutGroup?.position ?? { x: 0, y: 0 },
            });

            for (const childNode of childNodesByNamespace.get(namespace) ?? []) {
                finalNodes.push(childNode);
            }

            for (const edge of internalEdgesByNamespace.get(namespace) ?? []) {
                addEdgeSafe(edge);
            }
        }

        for (const target of graph.nodes) {
            for (const incoming of target.incomingEdges ?? []) {
                const sourceId = mapToRenderedEndpointId(incoming.sourceNodeId);
                const targetId = mapToRenderedTargetEndpointId(
                    incoming.sourceNodeId,
                    target.id,
                    incoming.targetNodeInputId,
                );

                if (sourceId === targetId) {
                    continue;
                }

                const sourceNode = nodeMap.get(incoming.sourceNodeId);
                const outputMeta = sourceNode?.outputsMetadata?.find((m) => m.id === incoming.sourceNodeOutputId);
                const edgeLabel = outputMeta ? getTensorInfoFromAttrs(outputMeta.attrs).label : undefined;

                addEdgeSafe({
                    id: `top:${sourceId}->${targetId}:${incoming.targetNodeInputId}`,
                    source: sourceId,
                    target: targetId,
                    label: edgeLabel || `${incoming.sourceNodeOutputId}→${incoming.targetNodeInputId}`,
                    markerEnd: { type: MarkerType.ArrowClosed, height: 20, width: 20 },
                });
            }
        }

        // Some namespace bodies are disconnected in raw data; preserve high-level links used for layout.
        for (const edge of topLevelEdgesForLayout) {
            const renderedSource = mapTopLevelEndpointToRenderedEndpoint(edge.source);
            const renderedTarget = mapTopLevelEndpointToRenderedEndpoint(edge.target);
            const pair = `${renderedSource}->${renderedTarget}`;
            if (renderedSource === renderedTarget || finalEdgePairSeen.has(pair)) {
                continue;
            }

            addEdgeSafe({
                id: `bridge:${pair}`,
                source: renderedSource,
                target: renderedTarget,
                markerEnd: { type: MarkerType.ArrowClosed, height: 20, width: 20 },
                style: {
                    strokeDasharray: '6 4',
                    opacity: 0.7,
                },
            });
        }

        return { nodes: finalNodes, edges: finalEdges };
    }, [
        anchorNamespaceByNodeId,
        expandedNamespaces,
        graph.nodes,
        namespaceAnchorNodeByNamespace,
        namespaceInputNodeIdsByNamespace,
        nodeMap,
        outerNamespaceByNodeId,
        subgraphNamespaces,
    ]);

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            const visibleGraph = await buildVisibleGraph();

            if (!cancelled) {
                setNodes(visibleGraph.nodes);
                setEdges(visibleGraph.edges);

                if (!hasFitInitially) {
                    requestAnimationFrame(() => {
                        void fitView({ padding: 0.2, duration: 200 });
                    });
                    setHasFitInitially(true);
                }
            }
        };

        void run();

        return () => {
            cancelled = true;
        };
    }, [buildVisibleGraph, fitView, hasFitInitially, setEdges, setNodes]);

    const doLayout = useCallback(async () => {
        const visibleGraph = await buildVisibleGraph();
        setNodes(visibleGraph.nodes);
        setEdges(visibleGraph.edges);
    }, [buildVisibleGraph, setEdges, setNodes]);

    const onSubgraphNodeClick = useCallback(
        (_event: MouseEvent, node: Node<MLNodeData>) => {
            if (node.type === 'group' && node.data?.namespace) {
                const ns = node.data.namespace;
                if (subgraphNamespaces.includes(ns)) {
                    setExpandedNamespaces((prev) => {
                        const next = new Set(prev);
                        next.delete(ns);
                        return next;
                    });
                }
                return;
            }
            const collapsedNs = node.data?.collapsedSubgraphNamespace;
            if (collapsedNs) {
                setExpandedNamespaces((prev) => {
                    const next = new Set(prev);
                    next.add(collapsedNs);
                    return next;
                });
            }
        },
        [subgraphNamespaces],
    );

    const nodeTypes = useMemo(
        () => ({
            mlirOp: MlirOpNode,
        }),
        [],
    );

    return (
        <div style={{ width: '100%', height: 'calc(100vh - 92px - 30px - 56px - 40px)' }}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodeClick={onSubgraphNodeClick}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                minZoom={0.05}
                maxZoom={1.5}
                fitView
                connectionLineType={ConnectionLineType.SmoothStep}
            >
                <MiniMap />
                <Controls />
                <Background />
            </ReactFlow>

            <Button
                onClick={() => void doLayout()}
                style={{
                    position: 'absolute',
                    top: 80,
                    left: 12,
                    zIndex: 10,
                    padding: '8px 10px',
                }}
            >
                Re-layout (ELK)
            </Button>
        </div>
    );
};

const MlGraphWithProvider: React.FC<ViewProps> = (props) => (
    <ReactFlowProvider>
        {/* eslint-disable-next-line react/jsx-props-no-spreading */}
        <MlGraphInner {...props} />
    </ReactFlowProvider>
);

export default MlGraphWithProvider;
