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

export function buildGraphIndex(graphId: string, nodes: SourceNode[]): GraphIndex {
    const nodeIndexById = new Map(nodes.map((n, idx) => [n.id, idx]));
    const nodesByNamespace = new Map<string, SourceNode[]>();
    const labelsByNamespace = new Map<string, Set<string>>();
    const namespacesWithChildren = new Set<string>();

    for (const node of nodes) {
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

    const subgraphNsSet = new Set(subgraphNamespaces);
    const containingNamespacesByNodeId: Record<string, string[]> = {};
    for (const node of nodes) {
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
    for (const node of nodes) {
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
        nodes: nodes.map((node) => ({
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
    };
}
