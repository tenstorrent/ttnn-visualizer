/* eslint-disable no-continue */
import type { GraphIndex, SourceNode } from './mlirGraphTypes';

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

const getNodeAttrValue = (node: SourceNode, key: string): string | undefined =>
    node.attrs.find((attr) => attr.key === key)?.value;

const getNamespaceOrdinal = (namespace: string): number => {
    const leaf = getShortName(namespace);
    const match = leaf.match(/_(\d+)$/);
    return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
};

const SECTION_THRESHOLD = 500;
const MAX_INITIAL_VISIBLE = 500;

/**
 * DFS-based topology-aware split inspired by Model Explorer's splitLargeGroupNodes.
 * Builds a lightweight adjacency map, finds roots, then DFS-traverses filling
 * fixed-size buckets. Connected sub-trees stay in the same bucket, producing
 * more meaningful sections than iteration-order bucketing.
 * Uses an iterative stack to avoid overflow on deep graphs.
 */
function splitByTopology(nodes: SourceNode[], threshold: number): SourceNode[][] | null {
    if (nodes.length <= threshold) {
        return null;
    }

    const nodeIdSet = new Set(nodes.map((n) => n.id));
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const outgoing = new Map<string, string[]>();
    const hasIncoming = new Set<string>();

    for (const node of nodes) {
        for (const edge of node.incomingEdges ?? []) {
            if (!nodeIdSet.has(edge.sourceNodeId) || edge.sourceNodeId === node.id) {
                continue;
            }
            const arr = outgoing.get(edge.sourceNodeId) ?? [];
            arr.push(node.id);
            outgoing.set(edge.sourceNodeId, arr);
            hasIncoming.add(node.id);
        }
    }

    const roots: string[] = [];
    for (const node of nodes) {
        if (!hasIncoming.has(node.id)) {
            roots.push(node.id);
        }
    }

    const buckets: SourceNode[][] = [];
    let current: SourceNode[] = [];
    const visited = new Set<string>();

    // Iterative DFS — push children in reverse so first child is popped first
    const stack: string[] = [...roots].reverse();

    while (stack.length > 0) {
        const nodeId = stack.pop()!;
        if (visited.has(nodeId)) {
            continue;
        }
        visited.add(nodeId);
        const node = nodeById.get(nodeId);
        if (!node) {
            continue;
        }
        current.push(node);
        if (current.length >= threshold) {
            buckets.push(current);
            current = [];
        }
        const children = outgoing.get(nodeId) ?? [];
        for (let i = children.length - 1; i >= 0; i--) {
            if (!visited.has(children[i])) {
                stack.push(children[i]);
            }
        }
    }

    // Sweep disconnected nodes not reached by DFS
    for (const node of nodes) {
        if (!visited.has(node.id)) {
            current.push(node);
            if (current.length >= threshold) {
                buckets.push(current);
                current = [];
            }
        }
    }

    if (current.length > 0) {
        buckets.push(current);
    }
    return buckets.length > 1 ? buckets : null;
}

function applyTopologySectioning(nodes: SourceNode[]): {
    effectiveNodes: SourceNode[];
    sectionNamespaces: Set<string>;
} {
    const sectionNamespaces = new Set<string>();

    // Split namespace-less nodes using topology-aware DFS
    const namespaceless: SourceNode[] = [];
    for (const node of nodes) {
        if (!node.namespace) {
            namespaceless.push(node);
        }
    }

    if (namespaceless.length <= SECTION_THRESHOLD) {
        return { effectiveNodes: nodes, sectionNamespaces };
    }

    const buckets = splitByTopology(namespaceless, SECTION_THRESHOLD);
    if (!buckets || buckets.length <= 1) {
        return { effectiveNodes: nodes, sectionNamespaces };
    }

    const remapById = new Map<string, string>();
    for (let i = 0; i < buckets.length; i++) {
        const sectionNs = `section_${i + 1}_of_${buckets.length}`;
        sectionNamespaces.add(sectionNs);
        for (const node of buckets[i]) {
            remapById.set(node.id, sectionNs);
        }
    }

    const effectiveNodes = nodes.map((node) => {
        const ns = remapById.get(node.id);
        return ns ? { ...node, namespace: ns } : node;
    });

    return { effectiveNodes, sectionNamespaces };
}

export function buildGraphIndex(graphId: string, nodes: SourceNode[]): GraphIndex {
    const { effectiveNodes, sectionNamespaces } = applyTopologySectioning(nodes);

    const nodeIndexById = new Map(effectiveNodes.map((n, idx) => [n.id, idx]));
    const nodesByNamespace = new Map<string, SourceNode[]>();
    const labelsByNamespace = new Map<string, Set<string>>();
    const namespacesWithChildren = new Set<string>();

    for (const node of effectiveNodes) {
        if (!node.namespace) {
            continue;
        }
        const inNamespace = nodesByNamespace.get(node.namespace);
        if (inNamespace) {
            inNamespace.push(node);
            labelsByNamespace.get(node.namespace)?.add(node.label);
        } else {
            nodesByNamespace.set(node.namespace, [node]);
            labelsByNamespace.set(node.namespace, new Set([node.label]));
        }

        const segments = node.namespace.split('/');
        for (let i = 1; i < segments.length; i++) {
            namespacesWithChildren.add(segments.slice(0, i).join('/'));
        }
    }

    const collapsibleNamespaces: string[] = [];
    for (const namespace of nodesByNamespace.keys()) {
        const expectedLabel = getRegionBaseOpLabel(namespace);
        if (!labelsByNamespace.get(namespace)?.has(expectedLabel)) {
            continue;
        }
        if (namespacesWithChildren.has(namespace)) {
            collapsibleNamespaces.push(namespace);
            continue;
        }
        const parentNamespace = getParentNamespace(namespace);
        if (parentNamespace && labelsByNamespace.get(parentNamespace)?.has(expectedLabel)) {
            collapsibleNamespaces.push(namespace);
        }
    }

    const subgraphNamespaces = [...collapsibleNamespaces].sort((a, b) => {
        const ord = getNamespaceOrdinal(a) - getNamespaceOrdinal(b);
        return ord !== 0 ? ord : a.localeCompare(b);
    });

    const anchorByNamespace = new Map<string, string>();
    const anchorNamespaceByNodeId = new Map<string, string>();
    for (const namespace of subgraphNamespaces) {
        const expectedLabel = getRegionBaseOpLabel(namespace);
        const candidates = (nodesByNamespace.get(namespace) ?? []).filter((node) => node.label === expectedLabel);
        candidates.sort((a, b) => {
            const aPinned = a.config?.pinToGroupTop ? 1 : 0;
            const bPinned = b.config?.pinToGroupTop ? 1 : 0;
            if (aPinned !== bPinned) {
                return bPinned - aPinned;
            }
            return (nodeIndexById.get(a.id) ?? 0) - (nodeIndexById.get(b.id) ?? 0);
        });
        if (!candidates[0]) {
            continue;
        }
        anchorByNamespace.set(namespace, candidates[0].id);
        anchorNamespaceByNodeId.set(candidates[0].id, namespace);
    }

    // Phase 3: force-register topology-created section namespaces as collapsible
    const preSectionNsSet = new Set(subgraphNamespaces);
    for (const sectionNs of sectionNamespaces) {
        if (!preSectionNsSet.has(sectionNs)) {
            subgraphNamespaces.push(sectionNs);
            preSectionNsSet.add(sectionNs);
        }
        if (!anchorByNamespace.has(sectionNs)) {
            const nodesInSection = [...(nodesByNamespace.get(sectionNs) ?? [])];
            nodesInSection.sort((a, b) => (nodeIndexById.get(a.id) ?? 0) - (nodeIndexById.get(b.id) ?? 0));
            const anchor = nodesInSection.find((n) => !anchorNamespaceByNodeId.has(n.id)) ?? nodesInSection[0];
            if (anchor) {
                anchorByNamespace.set(sectionNs, anchor.id);
                anchorNamespaceByNodeId.set(anchor.id, sectionNs);
            }
        }
    }
    if (sectionNamespaces.size > 0) {
        subgraphNamespaces.sort((a, b) => {
            const ord = getNamespaceOrdinal(a) - getNamespaceOrdinal(b);
            return ord !== 0 ? ord : a.localeCompare(b);
        });
    }

    const outerNamespaceByNodeId = new Map<string, string>();
    const usedOuterNodeIds = new Set<string>();
    for (const namespace of subgraphNamespaces) {
        const parentNamespace = getParentNamespace(namespace);
        if (!parentNamespace) {
            continue;
        }
        const expectedLabel = getRegionBaseOpLabel(namespace);
        const namespaceNodes = nodesByNamespace.get(namespace) ?? [];
        const preferredLocations = new Set(
            namespaceNodes
                .filter((node) => node.label === expectedLabel)
                .map((node) => getNodeAttrValue(node, 'full_location'))
                .filter((value): value is string => Boolean(value)),
        );
        const outerCandidates = (nodesByNamespace.get(parentNamespace) ?? []).filter(
            (node) => node.label === expectedLabel && !usedOuterNodeIds.has(node.id),
        );
        outerCandidates.sort((a, b) => (nodeIndexById.get(a.id) ?? 0) - (nodeIndexById.get(b.id) ?? 0));
        const outerNode =
            outerCandidates.find((candidate) => {
                const location = getNodeAttrValue(candidate, 'full_location');
                return location ? preferredLocations.has(location) : false;
            }) ?? outerCandidates[0];
        if (!outerNode) {
            continue;
        }
        outerNamespaceByNodeId.set(outerNode.id, namespace);
        usedOuterNodeIds.add(outerNode.id);
    }

    // Phase 2: Visibility budget — promote additional namespaces to collapsible
    // so the initial fully-collapsed view stays under the node budget.
    const initialSubgraphNsSet = new Set(subgraphNamespaces);

    let uncollapsedCount = 0;
    const uncollapsedByNamespace = new Map<string, SourceNode[]>();

    for (const node of effectiveNodes) {
        if (!node.namespace) {
            uncollapsedCount++;
            continue;
        }
        const segments = node.namespace.split('/');
        let collapsed = false;
        for (let i = 1; i <= segments.length; i++) {
            if (initialSubgraphNsSet.has(segments.slice(0, i).join('/'))) {
                collapsed = true;
                break;
            }
        }
        if (!collapsed) {
            uncollapsedCount++;
            const arr = uncollapsedByNamespace.get(node.namespace) ?? [];
            arr.push(node);
            uncollapsedByNamespace.set(node.namespace, arr);
        }
    }

    if (uncollapsedCount > MAX_INITIAL_VISIBLE) {
        const candidates = [...uncollapsedByNamespace.entries()]
            .filter(([ns, group]) => group.length >= 2 && !initialSubgraphNsSet.has(ns))
            .sort(([, a], [, b]) => b.length - a.length);

        for (const [ns, group] of candidates) {
            if (uncollapsedCount <= MAX_INITIAL_VISIBLE) {
                break;
            }
            subgraphNamespaces.push(ns);

            if (!anchorByNamespace.has(ns)) {
                group.sort((a, b) => (nodeIndexById.get(a.id) ?? 0) - (nodeIndexById.get(b.id) ?? 0));
                anchorByNamespace.set(ns, group[0].id);
                anchorNamespaceByNodeId.set(group[0].id, ns);
            }

            uncollapsedCount -= group.length - 1;
        }

        // Second pass: try parent-namespace prefixes for remaining singletons
        if (uncollapsedCount > MAX_INITIAL_VISIBLE) {
            const updatedNsSet = new Set(subgraphNamespaces);
            const uncollapsedByParent = new Map<string, SourceNode[]>();

            for (const [ns, group] of uncollapsedByNamespace) {
                if (updatedNsSet.has(ns)) {
                    continue;
                }
                const parentNs = getParentNamespace(ns);
                if (!parentNs || updatedNsSet.has(parentNs)) {
                    continue;
                }
                const arr = uncollapsedByParent.get(parentNs) ?? [];
                arr.push(...group);
                uncollapsedByParent.set(parentNs, arr);
            }

            const parentCandidates = [...uncollapsedByParent.entries()]
                .filter(([, group]) => group.length >= 2)
                .sort(([, a], [, b]) => b.length - a.length);

            for (const [parentNs, group] of parentCandidates) {
                if (uncollapsedCount <= MAX_INITIAL_VISIBLE) {
                    break;
                }
                subgraphNamespaces.push(parentNs);

                if (!anchorByNamespace.has(parentNs)) {
                    group.sort((a, b) => (nodeIndexById.get(a.id) ?? 0) - (nodeIndexById.get(b.id) ?? 0));
                    anchorByNamespace.set(parentNs, group[0].id);
                    anchorNamespaceByNodeId.set(group[0].id, parentNs);
                }

                uncollapsedCount -= group.length - 1;
            }
        }

        subgraphNamespaces.sort((a, b) => {
            const ord = getNamespaceOrdinal(a) - getNamespaceOrdinal(b);
            return ord !== 0 ? ord : a.localeCompare(b);
        });
    }

    const subgraphNsSet = new Set(subgraphNamespaces);
    const containingNamespacesByNodeId: Record<string, string[]> = {};
    for (const node of effectiveNodes) {
        if (!node.namespace) {
            containingNamespacesByNodeId[node.id] = [];
            continue;
        }
        const containing: string[] = [];
        const segments = node.namespace.split('/');
        for (let i = 1; i <= segments.length; i++) {
            const ancestor = segments.slice(0, i).join('/');
            if (subgraphNsSet.has(ancestor)) {
                containing.push(ancestor);
            }
        }
        containingNamespacesByNodeId[node.id] = containing;
    }

    const inputNodesByNamespace = new Map<string, SourceNode[]>();
    const returnCandidatesByNamespace = new Map<string, SourceNode[]>();
    const argPattern = /^%arg\d+$/i;
    const returnPattern = /\.return$|^return$/i;
    for (const node of effectiveNodes) {
        if (!node.namespace) {
            continue;
        }
        if (subgraphNsSet.has(node.namespace) && returnPattern.test(node.label)) {
            const inNamespace = returnCandidatesByNamespace.get(node.namespace);
            if (inNamespace) {
                inNamespace.push(node);
            } else {
                returnCandidatesByNamespace.set(node.namespace, [node]);
            }
        }
        if ((node.incomingEdges ?? []).length !== 0) {
            continue;
        }
        const isArg = argPattern.test(node.label);
        const segments = node.namespace.split('/');
        for (let i = 1; i <= segments.length; i++) {
            const ancestor = segments.slice(0, i).join('/');
            if (!subgraphNsSet.has(ancestor)) {
                continue;
            }
            if (isArg || node.namespace.startsWith(`${ancestor}/Inputs`)) {
                const inAncestor = inputNodesByNamespace.get(ancestor);
                if (inAncestor) {
                    inAncestor.push(node);
                } else {
                    inputNodesByNamespace.set(ancestor, [node]);
                }
            }
        }
    }

    const namespaceInputByNamespace: Record<string, string[]> = {};
    const namespaceReturnNodeByNamespace: Record<string, string> = {};
    for (const namespace of subgraphNamespaces) {
        const inputNodes = inputNodesByNamespace.get(namespace) ?? [];
        inputNodes.sort((a, b) => {
            const aIdx = Number(a.label.match(/^%arg(\d+)$/i)?.[1] ?? Infinity);
            const bIdx = Number(b.label.match(/^%arg(\d+)$/i)?.[1] ?? Infinity);
            return aIdx !== bIdx ? aIdx - bIdx : (nodeIndexById.get(a.id) ?? 0) - (nodeIndexById.get(b.id) ?? 0);
        });
        namespaceInputByNamespace[namespace] = inputNodes.map((node) => node.id);

        const returnCandidates = returnCandidatesByNamespace.get(namespace) ?? [];
        returnCandidates.sort((a, b) => (nodeIndexById.get(b.id) ?? 0) - (nodeIndexById.get(a.id) ?? 0));
        if (returnCandidates[0]) {
            namespaceReturnNodeByNamespace[namespace] = returnCandidates[0].id;
        }
    }

    return {
        graphId,
        nodes: effectiveNodes.map((node) => ({
            id: node.id,
            label: node.label,
            namespace: node.namespace,
            incomingEdges: node.incomingEdges,
            outputsMetadata: node.outputsMetadata,
            config: node.config,
        })),
        subgraphNamespaces,
        anchorByNamespace: Object.fromEntries(anchorByNamespace),
        anchorNamespaceByNodeId: Object.fromEntries(anchorNamespaceByNodeId),
        namespaceInputByNamespace,
        namespaceReturnNodeByNamespace,
        containingNamespacesByNodeId,
        outerNamespaceByNodeId: Object.fromEntries(outerNamespaceByNodeId),
        sectionNamespaces: [...sectionNamespaces],
    };
}
