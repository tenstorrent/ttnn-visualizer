// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/* eslint-disable no-continue */
import dagre from '@dagrejs/dagre';
import { getNamespaceSegments, getShortName, pushTo } from './mlirGraphHelpers';
import type {
    BuiltGraph,
    GraphIndex,
    IndexedAttr,
    IndexedEdge,
    IndexedNode,
    WorkerEdge,
    WorkerNode,
} from './mlirGraphTypes';

const GROUP_MIN_WIDTH = 260;
const GROUP_MIN_HEIGHT = 140;
const GROUP_PADDING_X = 24;
const GROUP_PADDING_TOP = 36;
const GROUP_PADDING_BOTTOM = 20;

const DAGRE_NODE_LIMIT = 2000;

const ARROW_MARKER = { type: 'arrowclosed', height: 20, width: 20 } as const;

/**
 * Edges carry the producer's output tensor info as a label (e.g. `1×3×224×224 f32`).
 * Falls back to `outputId→inputId` so collapsed edges that lose tensor metadata
 * still show a hint of which port wired up to which.
 */
function getEdgeLabelFor(incoming: IndexedEdge, nodeById: Map<string, IndexedNode>): string {
    const sourceNode = nodeById.get(incoming.sourceNodeId);
    const outputMeta = sourceNode?.outputsMetadata?.find((m) => m.id === incoming.sourceNodeOutputId);
    const tensorLabel = outputMeta ? getTensorInfoFromAttrs(outputMeta.attrs).label : undefined;
    return tensorLabel || `${incoming.sourceNodeOutputId}→${incoming.targetNodeInputId}`;
}

type DagreOptions = {
    nodesep?: number;
    ranksep?: number;
    edgesep?: number;
    ranker?: string;
};

function dagreLayout(nodes: WorkerNode[], edges: WorkerEdge[]): WorkerNode[] {
    if (nodes.length === 0) {
        return nodes;
    }
    const opts: DagreOptions =
        nodes.length > DAGRE_NODE_LIMIT
            ? { nodesep: 10, ranksep: 50, edgesep: 5, ranker: 'tight-tree' }
            : { ranker: 'tight-tree' };
    try {
        return dagreLayoutCore(nodes, edges, opts);
    } catch {
        return dagreLayoutCore(nodes, edges, { nodesep: 12, ranksep: 50, edgesep: 5 });
    }
}

function dagreLayoutCore(nodes: WorkerNode[], edges: WorkerEdge[], opts?: DagreOptions): WorkerNode[] {
    const g = new dagre.graphlib.Graph();
    g.setGraph({
        rankdir: 'TB',
        nodesep: opts?.nodesep ?? 30,
        ranksep: opts?.ranksep ?? 80,
        edgesep: opts?.edgesep ?? 10,
        ranker: opts?.ranker ?? 'network-simplex',
        marginx: 20,
        marginy: 20,
    });
    g.setDefaultEdgeLabel(() => ({}));

    const idSet = new Set<string>();
    for (const n of nodes) {
        const { width, height } = getNodeLayoutSize(n);
        g.setNode(n.id, { width, height });
        idSet.add(n.id);
    }

    for (const e of edges) {
        if (idSet.has(e.source) && idSet.has(e.target) && e.source !== e.target) {
            g.setEdge(e.source, e.target);
        }
    }

    dagre.layout(g);

    return nodes.map((n) => {
        const pos = g.node(n.id);
        const { width, height } = getNodeLayoutSize(n);
        return {
            ...n,
            position: {
                x: pos.x - width / 2,
                y: pos.y - height / 2,
            },
        };
    });
}

function toggleNamespaceForNode(index: GraphIndex, nodeId: string): string | undefined {
    return index.anchorNamespaceByNodeId[nodeId] ?? index.outerNamespaceByNodeId[nodeId];
}

function formatSectionLabel(namespace: string): string {
    return getShortName(namespace).replace(/_/g, ' ');
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

function getBounds(nodes: WorkerNode[]) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
        const { width, height } = getNodeLayoutSize(n);
        if (n.position.x < minX) {
            minX = n.position.x;
        }
        if (n.position.y < minY) {
            minY = n.position.y;
        }
        const right = n.position.x + width;
        const bottom = n.position.y + height;
        if (right > maxX) {
            maxX = right;
        }
        if (bottom > maxY) {
            maxY = bottom;
        }
    }
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

function makeOpNode(
    node: IndexedNode,
    toggle?: { namespace: string; state: 'collapsed' | 'expanded' },
    displayLabelOverride?: string,
): WorkerNode {
    const label = displayLabelOverride ?? node.label;
    const { width, height } = estimateOpNodeDimensions(label);
    // Visual chrome (background / border / text styling) lives in SCSS under
    // `.react-flow__node-mlirOp`. Only the dagre-computed dimensions are set
    // inline so React Flow's container matches the laid-out size and `dagre`'s
    // layout assumptions don't drift from the rendered DOM.
    return {
        id: node.id,
        data: {
            label,
            kind: 'op',
            namespace: node.namespace,
            ...(toggle ? { collapsedSubgraphNamespace: toggle.namespace, subgraphToggleState: toggle.state } : {}),
        },
        type: 'mlirOp',
        position: { x: 0, y: 0 },
        width,
        height,
        style: { width, height, boxSizing: 'border-box' },
    };
}

export function buildVisibleGraph(index: GraphIndex, expandedNamespacesList: string[]): BuiltGraph {
    const subgraphNamespaceSet = new Set(index.subgraphNamespaces);
    const sectionNsSet = new Set(index.sectionNamespaces ?? []);

    // A namespace's "expanded" state is only honoured when every subgraph
    // ancestor in its chain is ALSO expanded. Otherwise the user has
    // collapsed an ancestor, so the deeper namespace can't visibly exist —
    // honouring it would leave its group rendered as a top-level orphan
    // (e.g. an `Inputs` subgroup floating where its parent reduce used to be).
    // Filtering here, once, keeps every downstream `expandedNamespaces.has(...)`
    // check honest without each callsite having to re-validate the chain.
    const requestedExpansion = new Set(expandedNamespacesList);
    const expandedNamespaces = new Set<string>();
    for (const ns of requestedExpansion) {
        const segments = getNamespaceSegments(ns);
        let chainOk = true;
        for (let i = 1; i < segments.length; i++) {
            const ancestor = segments.slice(0, i).join('/');
            if (subgraphNamespaceSet.has(ancestor) && !requestedExpansion.has(ancestor)) {
                chainOk = false;
                break;
            }
        }
        if (chainOk) {
            expandedNamespaces.add(ns);
        }
    }

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

    const visibleRawNodes: IndexedNode[] = [];
    const visibleNodesByParentNs = new Map<string, IndexedNode[]>();
    const parentNamespaceByVisibleNodeId = new Map<string, string>();

    for (const n of index.nodes) {
        if (resolveRenderedNodeId(n.id) !== n.id) {
            continue;
        }
        visibleRawNodes.push(n);
        const parentNamespace = getExpandedParentNamespaceForVisibleNode(n.id);
        if (parentNamespace) {
            parentNamespaceByVisibleNodeId.set(n.id, parentNamespace);
            pushTo(visibleNodesByParentNs, parentNamespace, n);
        }
    }

    const nodesByContainingNs = new Map<string, IndexedNode[]>();
    for (const n of index.nodes) {
        const chain = index.containingNamespacesByNodeId[n.id] ?? [];
        for (const ns of chain) {
            pushTo(nodesByContainingNs, ns, n);
        }
    }

    const getExpandedParentOfNamespace = (namespace: string): string | undefined => {
        const segments = getNamespaceSegments(namespace);
        let result: string | undefined;
        for (let i = 1; i < segments.length; i++) {
            const ancestor = segments.slice(0, i).join('/');
            if (expandedNamespaces.has(ancestor) && subgraphNamespaceSet.has(ancestor)) {
                result = ancestor;
            }
        }
        return result;
    };

    const expandedParentOfNamespace = new Map<string, string>();
    for (const ns of index.subgraphNamespaces) {
        if (!expandedNamespaces.has(ns)) {
            continue;
        }
        const parent = getExpandedParentOfNamespace(ns);
        if (parent) {
            expandedParentOfNamespace.set(ns, parent);
        }
    }

    const expandedByDepthDesc = index.subgraphNamespaces
        .filter((ns) => expandedNamespaces.has(ns))
        .sort((a, b) => b.split('/').length - a.split('/').length);

    const groupNodeByNamespace = new Map<string, WorkerNode>();
    const childNodesByNamespace = new Map<string, WorkerNode[]>();
    const internalEdgesByNamespace = new Map<string, WorkerEdge[]>();

    const mapToChildEndpointId = (nodeId: string, ownerNamespace: string): string => {
        const renderedId = resolveRenderedNodeId(nodeId);
        const nodeParentNs = parentNamespaceByVisibleNodeId.get(renderedId);
        if (nodeParentNs === ownerNamespace) {
            return renderedId;
        }
        const chain = index.containingNamespacesByNodeId[nodeId] ?? [];
        for (const ns of chain) {
            if (expandedNamespaces.has(ns) && expandedParentOfNamespace.get(ns) === ownerNamespace) {
                return `group:${ns}`;
            }
        }
        return renderedId;
    };

    for (const namespace of expandedByDepthDesc) {
        const directChildRawNodes = visibleNodesByParentNs.get(namespace) ?? [];

        const childOpNodes: WorkerNode[] = directChildRawNodes.map((n) => {
            const toggleNs = toggleNamespaceForNode(index, n.id);
            const isSectionAnchor = !!toggleNs && sectionNsSet.has(toggleNs);
            // The group's own header now provides the collapse control. If the
            // anchor for THIS namespace happens to render inside this expanded
            // group, don't decorate it as a per-node toggle — that's misleading
            // (a single op shouldn't appear to "control" the whole group).
            const isOwnGroupAnchor = toggleNs === namespace;
            const showToggleHint = !!toggleNs && !isOwnGroupAnchor;
            return makeOpNode(
                n,
                showToggleHint && toggleNs
                    ? { namespace: toggleNs, state: expandedNamespaces.has(toggleNs) ? 'expanded' : 'collapsed' }
                    : undefined,
                isSectionAnchor && toggleNs && !expandedNamespaces.has(toggleNs)
                    ? formatSectionLabel(toggleNs)
                    : undefined,
            );
        });

        const nestedGroupNodes: WorkerNode[] = [];
        for (const [nestedNs, parentNs] of expandedParentOfNamespace) {
            if (parentNs === namespace) {
                const g = groupNodeByNamespace.get(nestedNs);
                if (g) {
                    nestedGroupNodes.push(g);
                }
            }
        }

        const allChildNodes = [...childOpNodes, ...nestedGroupNodes];
        const allChildIds = new Set(allChildNodes.map((n) => n.id));

        const collapsedChildIds = new Set(
            directChildRawNodes
                .filter((n) => {
                    const toggleNs = toggleNamespaceForNode(index, n.id);
                    return toggleNs && !expandedNamespaces.has(toggleNs);
                })
                .map((n) => n.id),
        );

        const internalEdgesSeen = new Set<string>();
        const internalPairSeen = new Set<string>();
        const internalEdges: WorkerEdge[] = [];
        const nodesInThisNs = nodesByContainingNs.get(namespace) ?? [];
        for (const target of nodesInThisNs) {
            const targetChildId = mapToChildEndpointId(target.id, namespace);
            if (!allChildIds.has(targetChildId)) {
                continue;
            }
            for (const incoming of target.incomingEdges ?? []) {
                const sourceChildId = mapToChildEndpointId(incoming.sourceNodeId, namespace);
                if (!allChildIds.has(sourceChildId) || sourceChildId === targetChildId) {
                    continue;
                }
                const bothCollapsed = collapsedChildIds.has(sourceChildId) && collapsedChildIds.has(targetChildId);
                const eitherCollapsed = collapsedChildIds.has(sourceChildId) || collapsedChildIds.has(targetChildId);
                const pairKey = `${sourceChildId}->${targetChildId}`;
                if (bothCollapsed && internalPairSeen.has(pairKey)) {
                    continue;
                }
                const edgeId = bothCollapsed
                    ? `internal:${pairKey}`
                    : `internal:${pairKey}:${incoming.targetNodeInputId}`;
                if (internalEdgesSeen.has(edgeId)) {
                    continue;
                }
                internalEdgesSeen.add(edgeId);
                internalPairSeen.add(pairKey);
                internalEdges.push({
                    id: edgeId,
                    source: sourceChildId,
                    target: targetChildId,
                    label: eitherCollapsed ? undefined : getEdgeLabelFor(incoming, nodeById),
                    markerEnd: { ...ARROW_MARKER },
                });
            }
        }

        const laidOutChildren = dagreLayout(allChildNodes, internalEdges);
        const bounds = laidOutChildren.length > 0 ? getBounds(laidOutChildren) : undefined;
        const groupWidth = bounds
            ? Math.max(GROUP_MIN_WIDTH, bounds.maxX - bounds.minX + GROUP_PADDING_X * 2)
            : GROUP_MIN_WIDTH;
        const groupHeight = bounds
            ? Math.max(GROUP_MIN_HEIGHT, bounds.maxY - bounds.minY + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM)
            : GROUP_MIN_HEIGHT;

        const groupId = `group:${namespace}`;
        const normalizedChildren = laidOutChildren.map((child) => ({
            ...child,
            parentId: groupId,
            extent: 'parent' as const,
            position: bounds
                ? {
                      x: child.position.x - bounds.minX + GROUP_PADDING_X,
                      y: child.position.y - bounds.minY + GROUP_PADDING_TOP,
                  }
                : { x: GROUP_PADDING_X, y: GROUP_PADDING_TOP },
        }));

        childNodesByNamespace.set(namespace, normalizedChildren);
        internalEdgesByNamespace.set(namespace, internalEdges);

        const isSection = sectionNsSet.has(namespace);
        const leafName = getShortName(namespace);
        const displayName = isSection ? formatSectionLabel(namespace) : leafName;
        const nodeCount = nodesByContainingNs.get(namespace)?.length ?? 0;

        groupNodeByNamespace.set(namespace, {
            id: groupId,
            type: 'mlirGroup',
            // Intentionally non-draggable: React Flow injects a `nopan` class on
            // every draggable node, and at runtime its pan filter checks
            // `event.target.closest('.nopan')` — that lookup ALWAYS finds our
            // wrapper from any descendant (or even via pointer-events: none
            // cascading), suppressing canvas pan inside the group. By keeping
            // the group non-draggable we drop the `nopan` from the wrapper, so
            // dragging the group's empty background pans the entire canvas
            // exactly as it does outside the group. The header itself opts back
            // into `nopan` (see `MlirGroupNode`) so clicks/drags on it never
            // trigger a stray canvas pan.
            draggable: false,
            data: {
                label: displayName,
                kind: 'group',
                namespace,
                displayName,
                nodeCount,
                groupKind: isSection ? 'section' : 'plain',
            },
            position: { x: 0, y: 0 },
            width: groupWidth,
            height: groupHeight,
            // Visual chrome (transparent wrapper, dashed body via descendant
            // .mlir-group-body) lives in SCSS under `.react-flow__node-mlirGroup`.
            // Inline dimensions remain so React Flow sizes the container to
            // match the laid-out bounds.
            style: { width: groupWidth, height: groupHeight },
        });
    }

    const topLevelOpNodes: WorkerNode[] = visibleRawNodes
        .filter((n) => !parentNamespaceByVisibleNodeId.has(n.id))
        .map((n) => {
            const toggleNs = toggleNamespaceForNode(index, n.id);
            const isSectionAnchor = !!toggleNs && sectionNsSet.has(toggleNs);
            return makeOpNode(
                n,
                toggleNs
                    ? { namespace: toggleNs, state: expandedNamespaces.has(toggleNs) ? 'expanded' : 'collapsed' }
                    : undefined,
                isSectionAnchor && toggleNs && !expandedNamespaces.has(toggleNs)
                    ? formatSectionLabel(toggleNs)
                    : undefined,
            );
        });

    const topLevelGroupNodes = expandedByDepthDesc
        .filter((ns) => !expandedParentOfNamespace.has(ns))
        .map((ns) => groupNodeByNamespace.get(ns)!)
        .filter(Boolean);

    const topLevelNodes = [...topLevelGroupNodes, ...topLevelOpNodes];

    const mapToTopLevelEndpointId = (nodeId: string): string => {
        const renderedId = resolveRenderedNodeId(nodeId);
        const parentNamespace = parentNamespaceByVisibleNodeId.get(renderedId);
        if (!parentNamespace) {
            return renderedId;
        }
        let ns: string | undefined = parentNamespace;
        while (ns && expandedParentOfNamespace.has(ns)) {
            ns = expandedParentOfNamespace.get(ns);
        }
        return ns ? `group:${ns}` : renderedId;
    };

    const mapToRenderedSourceEndpointId = (sourceNodeId: string): string => {
        const renderedId = resolveRenderedNodeId(sourceNodeId);
        // Return-node remapping mirrors the input-port remapping on the target
        // side: the chosen return node may itself live inside a nested
        // collapsed sub-namespace, so we resolve through resolveRenderedNodeId
        // to land on the deepest visible anchor and avoid edges that point at
        // unrendered ids (silently dropped by React Flow).
        const outerNs = index.outerNamespaceByNodeId[renderedId];
        if (outerNs && expandedNamespaces.has(outerNs)) {
            const returnNodeId = index.namespaceReturnNodeByNamespace[outerNs];
            if (returnNodeId) {
                return resolveRenderedNodeId(returnNodeId);
            }
        }
        const anchorNs = index.anchorNamespaceByNodeId[renderedId];
        if (anchorNs && expandedNamespaces.has(anchorNs)) {
            const returnNodeId = index.namespaceReturnNodeByNamespace[anchorNs];
            if (returnNodeId) {
                return resolveRenderedNodeId(returnNodeId);
            }
        }
        return renderedId;
    };

    const mapToRenderedTargetEndpointId = (
        sourceNodeId: string,
        targetNodeId: string,
        targetInputId?: string,
    ): string => {
        const sourceNamespaces = index.containingNamespacesByNodeId[sourceNodeId] ?? [];
        const targetNamespaces = index.containingNamespacesByNodeId[targetNodeId] ?? [];
        const targetNamespace = targetNamespaces[targetNamespaces.length - 1];
        const sourceNamespace = sourceNamespaces[sourceNamespaces.length - 1];

        // The "edge crossing into a region terminates at its block arg by
        // input-port index" remapping only applies to real MLIR regions, never
        // to synthetic topology sections. Sections are flat groupings of
        // unrelated ops and have no input boundary — a cross-section edge
        // must go directly to the inner op, otherwise the target gets
        // silently swapped for a phantom "section input" (typically a top-
        // level function `%argN`) and the real edge to the inner op vanishes.
        // The block-arg returned by namespaceInputByNamespace may itself live
        // inside a NESTED collapsed sub-namespace (typically `<region>/Inputs`).
        // In that case the block-arg node isn't actually rendered, so we must
        // resolve it through resolveRenderedNodeId — that walks the
        // containing-namespace chain and lands on the nearest visible anchor
        // (e.g. the collapsed `/Inputs` group's representative). Without this
        // fallback the edge points at a non-existent React Flow node and
        // silently disappears, leaving expanded regions looking like they
        // have no incoming connections.
        if (
            targetNamespace &&
            !sectionNsSet.has(targetNamespace) &&
            expandedNamespaces.has(targetNamespace) &&
            sourceNamespace !== targetNamespace
        ) {
            const sourceIsInsideTarget = sourceNamespaces.includes(targetNamespace);
            if (!sourceIsInsideTarget) {
                const inputIdx = Number(targetInputId);
                if (Number.isInteger(inputIdx) && inputIdx >= 0) {
                    const inputNodeId = index.namespaceInputByNamespace[targetNamespace]?.[inputIdx];
                    if (inputNodeId) {
                        return resolveRenderedNodeId(inputNodeId);
                    }
                }
            }
        }
        const collapsedNamespace = toggleNamespaceForNode(index, targetNodeId);
        if (collapsedNamespace && !sectionNsSet.has(collapsedNamespace) && expandedNamespaces.has(collapsedNamespace)) {
            const sourceIsInsideCollapsed = sourceNamespaces.includes(collapsedNamespace);
            if (!sourceIsInsideCollapsed) {
                const inputIdx = Number(targetInputId);
                if (Number.isInteger(inputIdx) && inputIdx >= 0) {
                    const inputNodeId = index.namespaceInputByNamespace[collapsedNamespace]?.[inputIdx];
                    if (inputNodeId) {
                        return resolveRenderedNodeId(inputNodeId);
                    }
                }
            }
        }
        return resolveRenderedNodeId(targetNodeId);
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
    const filteredTopLevelEdges = topLevelEdgesForLayout.filter(
        (e) => topLevelNodeIdSet.has(e.source) && topLevelNodeIdSet.has(e.target),
    );
    const laidOutTopLevelNodes = dagreLayout(topLevelNodes, filteredTopLevelEdges);
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
        const groupNode = groupNodeByNamespace.get(namespace);
        if (!groupNode) {
            continue;
        }
        const isNested = expandedParentOfNamespace.has(namespace);
        if (!isNested) {
            const position = topLevelNodeById.get(groupId)?.position ?? { x: 0, y: 0 };
            finalNodes.push({ ...groupNode, position });
        }
        for (const childNode of childNodesByNamespace.get(namespace) ?? []) {
            finalNodes.push(childNode);
        }
        for (const edge of internalEdgesByNamespace.get(namespace) ?? []) {
            addEdgeSafe(edge);
        }
    }

    for (const target of index.nodes) {
        for (const incoming of target.incomingEdges ?? []) {
            const sourceId = mapToRenderedSourceEndpointId(incoming.sourceNodeId);
            const targetId = mapToRenderedTargetEndpointId(
                incoming.sourceNodeId,
                target.id,
                incoming.targetNodeInputId,
            );
            if (sourceId === targetId) {
                continue;
            }
            const srcParentNs = parentNamespaceByVisibleNodeId.get(sourceId);
            const tgtParentNs = parentNamespaceByVisibleNodeId.get(targetId);
            if (srcParentNs && srcParentNs === tgtParentNs) {
                continue;
            }
            const bothTopLevel = !srcParentNs && !tgtParentNs;
            const pairKey = `${sourceId}->${targetId}`;
            if (bothTopLevel && finalEdgePairSeen.has(pairKey)) {
                continue;
            }
            // Strip labels only for edges between two top-level nodes where at least
            // one is a collapsed group anchor (truly aggregated, no selection can recover
            // per-edge meaning). Edges crossing expanded-community boundaries keep their
            // labels — the main thread decides per-selection whether to display the
            // labeled inner-endpoint edge or redirect it to the community boundary.
            const srcIsCollapsedAnchor =
                !!index.anchorNamespaceByNodeId[sourceId] &&
                !expandedNamespaces.has(index.anchorNamespaceByNodeId[sourceId]);
            const tgtIsCollapsedAnchor =
                !!index.anchorNamespaceByNodeId[targetId] &&
                !expandedNamespaces.has(index.anchorNamespaceByNodeId[targetId]);
            const isAggregatedAtTopLevel = bothTopLevel && (srcIsCollapsedAnchor || tgtIsCollapsedAnchor);
            addEdgeSafe({
                id: bothTopLevel ? `top:${pairKey}` : `top:${pairKey}:${incoming.targetNodeInputId}`,
                source: sourceId,
                target: targetId,
                label: isAggregatedAtTopLevel ? undefined : getEdgeLabelFor(incoming, nodeById),
                markerEnd: { ...ARROW_MARKER },
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
            markerEnd: { ...ARROW_MARKER },
            style: { strokeDasharray: '6 4', opacity: 0.7 },
        });
    }

    const edgesByPair = new Map<string, WorkerEdge[]>();
    for (const edge of finalEdges) {
        pushTo(edgesByPair, `${edge.source}->${edge.target}`, edge);
    }
    const BASE_CURVATURE = 0.25;
    const CURVATURE_STEP = 0.2;
    const LABEL_Y_STEP = 16;
    for (const [, edges] of edgesByPair) {
        if (edges.length <= 1) {
            continue;
        }
        const mid = (edges.length - 1) / 2;
        for (let i = 0; i < edges.length; i++) {
            const curvature = BASE_CURVATURE + (i - mid) * CURVATURE_STEP;
            const labelYOffset = Math.round((i - mid) * LABEL_Y_STEP);
            edges[i].pathOptions = { curvature };
            edges[i].labelStyle = { transform: `translateY(${labelYOffset}px)` };
        }
    }

    return { nodes: finalNodes, edges: finalEdges };
}
