/* eslint-disable no-await-in-loop */
/* eslint-disable no-continue */
import ELK, { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk.bundled';
import type { BuiltGraph, GraphIndex, IndexedAttr, IndexedNode, WorkerEdge, WorkerNode } from './mlirGraphTypes';

const GROUP_MIN_WIDTH = 260;
const GROUP_MIN_HEIGHT = 140;
const GROUP_PADDING_X = 24;
const GROUP_PADDING_TOP = 36;
const GROUP_PADDING_BOTTOM = 20;

type ElkLike = {
    layout: (graph: ElkNode) => Promise<ElkNode>;
};

let elkInstance: ElkLike | null = null;
let elkUnavailable = false;

function getElk(): ElkLike {
    if (elkUnavailable) {
        throw new Error('ELK disabled after previous initialization failure');
    }
    if (elkInstance) {
        return elkInstance;
    }
    const maybeCtor = ELK as unknown as { new (): ElkLike } | ElkLike;
    if (typeof maybeCtor === 'function') {
        elkInstance = new (maybeCtor as { new (): ElkLike })();
    } else if (maybeCtor && typeof (maybeCtor as ElkLike).layout === 'function') {
        elkInstance = maybeCtor as ElkLike;
    } else {
        throw new Error('ELK initialization failed: unexpected export shape');
    }
    return elkInstance;
}

function fallbackLayeredLayout(nodes: WorkerNode[], edges: WorkerEdge[]): WorkerNode[] {
    const idSet = new Set(nodes.map((n) => n.id));
    const indegree = new Map(nodes.map((n) => [n.id, 0]));
    const outgoing = new Map<string, string[]>();
    const levelById = new Map(nodes.map((n) => [n.id, 0]));

    for (const e of edges) {
        if (!idSet.has(e.source) || !idSet.has(e.target) || e.source === e.target) {
            continue;
        }
        indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
        const arr = outgoing.get(e.source) ?? [];
        arr.push(e.target);
        outgoing.set(e.source, arr);
    }

    const queue: string[] = [];
    indegree.forEach((deg, id) => {
        if (deg === 0) {
            queue.push(id);
        }
    });

    for (let qi = 0; qi < queue.length; qi += 1) {
        const id = queue[qi];
        const level = levelById.get(id) ?? 0;
        for (const outId of outgoing.get(id) ?? []) {
            const prev = levelById.get(outId) ?? 0;
            if (level + 1 > prev) {
                levelById.set(outId, level + 1);
            }
            const nextDeg = (indegree.get(outId) ?? 0) - 1;
            indegree.set(outId, nextDeg);
            if (nextDeg === 0) {
                queue.push(outId);
            }
        }
    }

    const byLevel = new Map<number, WorkerNode[]>();
    for (const n of nodes) {
        const level = levelById.get(n.id) ?? 0;
        const arr = byLevel.get(level) ?? [];
        arr.push(n);
        byLevel.set(level, arr);
    }

    const sortedLevels = [...byLevel.keys()].sort((a, b) => a - b);
    const laidOut: WorkerNode[] = [];
    const xGap = 220;
    const yGap = 110;
    for (const level of sortedLevels) {
        const bucket = byLevel.get(level) ?? [];
        bucket.sort((a, b) => a.id.localeCompare(b.id));
        bucket.forEach((n, idx) => {
            laidOut.push({ ...n, position: { x: idx * xGap, y: level * yGap } });
        });
    }
    return laidOut;
}

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

function toggleNamespaceForNode(index: GraphIndex, nodeId: string): string | undefined {
    return index.anchorNamespaceByNodeId[nodeId] ?? index.outerNamespaceByNodeId[nodeId];
}

function estimateOpNodeDimensions(label: string): { width: number; height: number } {
    const charW = 7.25;
    const padX = 32;
    const minW = 108;
    const maxW = 560;
    const width = Math.ceil(Math.min(maxW, Math.max(minW, label.length * charW + padX)));
    return { width, height: 40 };
}

function getNodeLayoutSize(n: WorkerNode): { width: number; height: number } {
    const style = n.style as { width?: number; height?: number } | undefined;
    const w = n.width ?? style?.width;
    const h = n.height ?? style?.height;
    const width = typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 180;
    const height = typeof h === 'number' && Number.isFinite(h) && h > 0 ? h : 48;
    return { width, height };
}

function toElkGraph(nodes: WorkerNode[], edges: WorkerEdge[]): ElkNode {
    return {
        id: 'root',
        layoutOptions: elkOptions,
        children: nodes.map((n) => {
            const { width, height } = getNodeLayoutSize(n);
            return { id: n.id, width, height };
        }),
        edges: edges.map((e) => ({
            id: e.id,
            sources: [e.source],
            targets: [e.target],
        })) as ElkExtendedEdge[],
    };
}

async function layoutWithElk(nodes: WorkerNode[], edges: WorkerEdge[]): Promise<WorkerNode[]> {
    if (nodes.length === 0) {
        return nodes;
    }
    try {
        const graph = toElkGraph(nodes, edges);
        const laidOut = await getElk().layout(graph);
        const positions = new Map<string, { x: number; y: number }>();
        (laidOut.children ?? []).forEach((c) => {
            positions.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
        });
        return nodes.map((n) => ({ ...n, position: positions.get(n.id) ?? { x: 0, y: 0 } }));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('not a constructor')) {
            elkUnavailable = true;
        }
        return fallbackLayeredLayout(nodes, edges);
    }
}

function getBounds(nodes: WorkerNode[]) {
    const minX = Math.min(...nodes.map((n) => n.position.x));
    const minY = Math.min(...nodes.map((n) => n.position.y));
    const maxX = Math.max(...nodes.map((n) => n.position.x + getNodeLayoutSize(n).width));
    const maxY = Math.max(...nodes.map((n) => n.position.y + getNodeLayoutSize(n).height));
    return { minX, minY, maxX, maxY };
}

function getTensorInfoFromAttrs(attrs: IndexedAttr[]) {
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
    return { label: prettyShape && dtype ? `${prettyShape} ${dtype}` : prettyShape || dtype };
}

function makeOpNode(node: IndexedNode, toggle?: { namespace: string; state: 'collapsed' | 'expanded' }): WorkerNode {
    const { width, height } = estimateOpNodeDimensions(node.label);
    return {
        id: node.id,
        data: {
            label: node.label,
            kind: 'op',
            namespace: node.namespace,
            ...(toggle ? { collapsedSubgraphNamespace: toggle.namespace, subgraphToggleState: toggle.state } : {}),
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
}

export async function buildVisibleGraph(index: GraphIndex, expandedNamespacesList: string[]): Promise<BuiltGraph> {
    const expandedNamespaces = new Set(expandedNamespacesList);
    const nodeById = new Map(index.nodes.map((n) => [n.id, n]));

    const resolveRenderedNodeId = (nodeId: string): string => {
        const chain = index.containingNamespacesByNodeId[nodeId] ?? [];
        for (const namespace of chain) {
            if (!expandedNamespaces.has(namespace)) {
                return index.anchorByNamespace[namespace] ?? nodeId;
            }
        }
        return nodeId;
    };

    const getExpandedParentNamespaceForVisibleNode = (nodeId: string): string | undefined => {
        const chain = index.containingNamespacesByNodeId[nodeId] ?? [];
        let parentNamespace: string | undefined;
        for (const namespace of chain) {
            if (!expandedNamespaces.has(namespace)) {
                break;
            }
            parentNamespace = namespace;
        }
        return parentNamespace;
    };

    const visibleRawNodes = index.nodes.filter((n) => resolveRenderedNodeId(n.id) === n.id);
    const parentNamespaceByVisibleNodeId = new Map<string, string>();
    for (const n of visibleRawNodes) {
        const parentNamespace = getExpandedParentNamespaceForVisibleNode(n.id);
        if (parentNamespace) {
            parentNamespaceByVisibleNodeId.set(n.id, parentNamespace);
        }
    }

    const groupNodesForTopLayout: WorkerNode[] = [];
    const childNodesByNamespace = new Map<string, WorkerNode[]>();
    const internalEdgesByNamespace = new Map<string, WorkerEdge[]>();

    for (const namespace of index.subgraphNamespaces) {
        if (!expandedNamespaces.has(namespace)) {
            continue;
        }
        const childRawNodes = visibleRawNodes.filter((n) => parentNamespaceByVisibleNodeId.get(n.id) === namespace);
        const childRawNodeIdSet = new Set(childRawNodes.map((n) => n.id));

        const childNodes: WorkerNode[] = childRawNodes.map((n) => {
            const toggleNs = toggleNamespaceForNode(index, n.id);
            return makeOpNode(
                n,
                toggleNs
                    ? { namespace: toggleNs, state: expandedNamespaces.has(toggleNs) ? 'expanded' : 'collapsed' }
                    : undefined,
            );
        });

        const internalEdgesSeen = new Set<string>();
        const internalEdges: WorkerEdge[] = [];
        for (const target of childRawNodes) {
            for (const incoming of target.incomingEdges ?? []) {
                if (!childRawNodeIdSet.has(incoming.sourceNodeId)) {
                    continue;
                }
                const edgeId = `internal:${incoming.sourceNodeId}->${target.id}:${incoming.targetNodeInputId}`;
                if (internalEdgesSeen.has(edgeId)) {
                    continue;
                }
                internalEdgesSeen.add(edgeId);
                const sourceRawNode = nodeById.get(incoming.sourceNodeId);
                const sourceOutputMeta = sourceRawNode?.outputsMetadata?.find(
                    (m) => m.id === incoming.sourceNodeOutputId,
                );
                const edgeLabel = sourceOutputMeta ? getTensorInfoFromAttrs(sourceOutputMeta.attrs).label : undefined;
                internalEdges.push({
                    id: edgeId,
                    source: incoming.sourceNodeId,
                    target: target.id,
                    sourceHandle: incoming.sourceNodeOutputId,
                    targetHandle: incoming.targetNodeInputId,
                    label: edgeLabel || `${incoming.sourceNodeOutputId}→${incoming.targetNodeInputId}`,
                    markerEnd: { type: 'arrowclosed', height: 20, width: 20 },
                });
            }
        }

        const laidOutChildren = await layoutWithElk(childNodes, internalEdges);
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
                : { x: GROUP_PADDING_X, y: GROUP_PADDING_TOP },
        }));

        childNodesByNamespace.set(namespace, normalizedChildren);
        internalEdgesByNamespace.set(namespace, internalEdges);
        groupNodesForTopLayout.push({
            id: `group:${namespace}`,
            type: 'group',
            data: { label: `▾ ${namespace.split('/').pop()} · click to collapse`, kind: 'group', namespace },
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

    const topLevelOpNodes: WorkerNode[] = visibleRawNodes
        .filter((n) => !parentNamespaceByVisibleNodeId.has(n.id))
        .map((n) => {
            const toggleNs = toggleNamespaceForNode(index, n.id);
            return makeOpNode(
                n,
                toggleNs
                    ? { namespace: toggleNs, state: expandedNamespaces.has(toggleNs) ? 'expanded' : 'collapsed' }
                    : undefined,
            );
        });

    const topLevelNodes = [...groupNodesForTopLayout, ...topLevelOpNodes];

    const mapToTopLevelEndpointId = (nodeId: string): string => {
        const renderedId = resolveRenderedNodeId(nodeId);
        const parentNamespace = parentNamespaceByVisibleNodeId.get(renderedId);
        return parentNamespace ? `group:${parentNamespace}` : renderedId;
    };
    const mapToRenderedEndpointId = (nodeId: string): string => resolveRenderedNodeId(nodeId);
    const mapToRenderedTargetEndpointId = (
        sourceNodeId: string,
        targetNodeId: string,
        targetInputId?: string,
    ): string => {
        const sourceNamespaces = index.containingNamespacesByNodeId[sourceNodeId] ?? [];
        const targetNamespaces = index.containingNamespacesByNodeId[targetNodeId] ?? [];
        const targetNamespace = targetNamespaces[targetNamespaces.length - 1];
        const sourceNamespace = sourceNamespaces[sourceNamespaces.length - 1];

        if (targetNamespace && expandedNamespaces.has(targetNamespace) && sourceNamespace !== targetNamespace) {
            const inputIdx = Number(targetInputId);
            if (Number.isInteger(inputIdx) && inputIdx >= 0) {
                const inputNodeId = index.namespaceInputByNamespace[targetNamespace]?.[inputIdx];
                if (inputNodeId) {
                    return inputNodeId;
                }
            }
        }
        const collapsedNamespace = toggleNamespaceForNode(index, targetNodeId);
        if (collapsedNamespace && expandedNamespaces.has(collapsedNamespace)) {
            const inputIdx = Number(targetInputId);
            if (Number.isInteger(inputIdx) && inputIdx >= 0) {
                const inputNodeId = index.namespaceInputByNamespace[collapsedNamespace]?.[inputIdx];
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
            return index.anchorByNamespace[namespace] ?? endpointId;
        }
        return endpointId;
    };

    const topLevelEdgeSeen = new Set<string>();
    const topLevelEdgesForLayout: WorkerEdge[] = [];
    for (const target of index.nodes) {
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
            topLevelEdgesForLayout.push({ id: edgeId, source: sourceId, target: targetId });
        }
    }

    const topLevelNodeIdSet = new Set(topLevelNodes.map((n) => n.id));
    const topLevelEdgesForElk = topLevelEdgesForLayout.filter(
        (e) => topLevelNodeIdSet.has(e.source) && topLevelNodeIdSet.has(e.target),
    );
    const laidOutTopLevelNodes = await layoutWithElk(topLevelNodes, topLevelEdgesForElk);
    const topLevelNodeById = new Map(laidOutTopLevelNodes.map((n) => [n.id, n]));

    const finalNodes: WorkerNode[] = [];
    const finalEdges: WorkerEdge[] = [];
    const finalEdgeSeen = new Set<string>();
    const finalEdgePairSeen = new Set<string>();

    const addEdgeSafe = (edge: WorkerEdge) => {
        if (edge.source === edge.target || finalEdgeSeen.has(edge.id)) {
            return;
        }
        finalEdgeSeen.add(edge.id);
        finalEdgePairSeen.add(`${edge.source}->${edge.target}`);
        finalEdges.push(edge);
    };

    for (const node of topLevelOpNodes) {
        const laidOut = topLevelNodeById.get(node.id);
        finalNodes.push({ ...node, position: laidOut?.position ?? node.position });
    }

    for (const namespace of index.subgraphNamespaces) {
        if (!expandedNamespaces.has(namespace)) {
            continue;
        }
        const groupId = `group:${namespace}`;
        const laidOutGroup = topLevelNodeById.get(groupId);
        const topLayoutGroup = groupNodesForTopLayout.find((n) => n.id === groupId);
        if (!topLayoutGroup) {
            continue;
        }
        finalNodes.push({ ...topLayoutGroup, position: laidOutGroup?.position ?? { x: 0, y: 0 } });
        for (const childNode of childNodesByNamespace.get(namespace) ?? []) {
            finalNodes.push(childNode);
        }
        for (const edge of internalEdgesByNamespace.get(namespace) ?? []) {
            addEdgeSafe(edge);
        }
    }

    for (const target of index.nodes) {
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
            const sourceNode = nodeById.get(incoming.sourceNodeId);
            const outputMeta = sourceNode?.outputsMetadata?.find((m) => m.id === incoming.sourceNodeOutputId);
            const edgeLabel = outputMeta ? getTensorInfoFromAttrs(outputMeta.attrs).label : undefined;
            addEdgeSafe({
                id: `top:${sourceId}->${targetId}:${incoming.targetNodeInputId}`,
                source: sourceId,
                target: targetId,
                label: edgeLabel || `${incoming.sourceNodeOutputId}→${incoming.targetNodeInputId}`,
                markerEnd: { type: 'arrowclosed', height: 20, width: 20 },
            });
        }
    }

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
            markerEnd: { type: 'arrowclosed', height: 20, width: 20 },
            style: { strokeDasharray: '6 4', opacity: 0.7 },
        });
    }

    return { nodes: finalNodes, edges: finalEdges };
}
