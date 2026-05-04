/* eslint-disable no-continue */
import { partitionByCommunity } from './mlirGraphPartitioner';
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

const SECTION_THRESHOLD = 1000;
const MAX_INITIAL_VISIBLE = 500;
/**
 * Communities larger than this get recursively re-partitioned by Louvain.
 * Combined with COMMUNITY_MIN_SIZE, this targets ~1000 nodes per community —
 * the user-defined visual-readability sweet spot.
 */
const COMMUNITY_MAX_SIZE = 1500;
/**
 * Communities smaller than this get folded into their best-connected neighbour
 * during Louvain post-processing. mergeUntilTargetK (driven by a dynamic
 * targetK = ceil(N/1000)) handles the bulk of the size enforcement.
 */
const COMMUNITY_MIN_SIZE = 50;
/**
 * Louvain resolution parameter γ. γ = 1 is the classic Louvain. γ < 1 favours
 * fewer, larger communities; γ > 1 favours more, smaller ones. Combined with
 * min/max size enforcement (500/1500) and post-hoc DFS splitting of oversized
 * buckets, γ=1 reliably lands communities in the ~1000-node range.
 */
const COMMUNITY_RESOLUTION = 1.0;

/**
 * Fallback DFS-based topology-aware split (inspired by Model Explorer's
 * splitLargeGroupNodes). Used only when modularity-based partitioning fails to
 * produce a meaningful split — e.g. for fully disconnected or pathological inputs.
 * Builds a lightweight adjacency map, finds roots, then DFS-traverses filling
 * fixed-size buckets. Iterative stack to avoid overflow on deep graphs.
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

const OP_GROUP_MIN_SIZE = 3;

/**
 * Groups root-level sibling namespaces that share the same base operation type
 * (e.g. stablehlo.reduce_1, stablehlo.reduce_2 → parent "stablehlo.reduce").
 * This inserts a virtual parent namespace so the index builder can collapse
 * all instances under one group node.
 */
function applyOpTypeGrouping(nodes: SourceNode[]): {
    effectiveNodes: SourceNode[];
    opGroupNamespaces: Set<string>;
} {
    const opGroupNamespaces = new Set<string>();

    const seenRootNs = new Set<string>();
    for (const node of nodes) {
        if (node.namespace && !node.namespace.includes('/')) {
            seenRootNs.add(node.namespace);
        }
    }

    const rootNsByBase = new Map<string, string[]>();
    for (const ns of seenRootNs) {
        const base = ns.replace(/_\d+$/, '');
        if (base === ns) {
            continue;
        }
        const arr = rootNsByBase.get(base) ?? [];
        arr.push(ns);
        rootNsByBase.set(base, arr);
    }

    const nsRemap = new Map<string, string>();
    for (const [base, namespaces] of rootNsByBase) {
        if (namespaces.length < OP_GROUP_MIN_SIZE) {
            continue;
        }
        opGroupNamespaces.add(base);
        for (const ns of namespaces) {
            nsRemap.set(ns, `${base}/${ns}`);
        }
    }

    if (nsRemap.size === 0) {
        return { effectiveNodes: nodes, opGroupNamespaces };
    }

    const effectiveNodes = nodes.map((node) => {
        if (!node.namespace) {
            return node;
        }
        const rootSegment = node.namespace.split('/')[0];
        const remapped = nsRemap.get(rootSegment);
        if (!remapped) {
            return node;
        }
        return { ...node, namespace: `${remapped}${node.namespace.slice(rootSegment.length)}` };
    });

    return { effectiveNodes, opGroupNamespaces };
}

/**
 * Section the full node set into ~1000-node communities. Operates on ALL nodes
 * (not just namespace-less ones) so even fully-namespaced graphs get grouped
 * into target-sized communities. A node's existing namespace, if any, is
 * preserved as a child path under its section: `section_K_of_N/<original>`.
 */
function applyTopologySectioning(nodes: SourceNode[]): {
    effectiveNodes: SourceNode[];
    sectionNamespaces: Set<string>;
} {
    const sectionNamespaces = new Set<string>();

    if (nodes.length <= SECTION_THRESHOLD) {
        return { effectiveNodes: nodes, sectionNamespaces };
    }

    // Target ~1000 nodes per section. Both ends are bounded so densely-connected
    // graphs (which Louvain leaves as one mega-community) and sparsely-connected
    // graphs (where Louvain finds many tiny communities, like one per MLIR
    // region) both converge to the same target count.
    const targetK = Math.max(2, Math.ceil(nodes.length / SECTION_THRESHOLD));

    // Primary: community detection (Louvain) — produces super-groups that
    // correspond to densely-connected sub-regions with sparse links between them.
    // mergeUntilTargetK collapses small communities into their best-connected
    // neighbours until we hit targetK. Internal recursion is disabled
    // (maxDepth: 1) because it shatters merged-down communities at depth=1
    // (no targetK enforcement at that level), undoing our size targeting.
    // Oversized buckets are split by the DFS safety net below instead.
    let buckets = partitionByCommunity(nodes, SECTION_THRESHOLD, {
        maxSize: COMMUNITY_MAX_SIZE,
        minSize: COMMUNITY_MIN_SIZE,
        targetK,
        resolution: COMMUNITY_RESOLUTION,
        maxDepth: 1,
    });

    // Fallback: fixed-size DFS bucketer. Triggers when Louvain couldn't find
    // ANY meaningful split (e.g. fully disconnected singletons, or one
    // dominant community).
    if (!buckets || buckets.length <= 1) {
        buckets = splitByTopology(nodes, SECTION_THRESHOLD);
    }
    if (!buckets || buckets.length <= 1) {
        return { effectiveNodes: nodes, sectionNamespaces };
    }

    // Safety net: even after Louvain + recursion, individual buckets can still
    // exceed the target size when the graph is densely connected. Force-split
    // any oversized bucket with DFS bucketing so no single section dwarfs the
    // others. Keeps community semantics for well-sized buckets, falls back to
    // topology slicing only where Louvain failed to do so.
    const enforcedBuckets: SourceNode[][] = [];
    for (const bucket of buckets) {
        if (bucket.length <= COMMUNITY_MAX_SIZE) {
            enforcedBuckets.push(bucket);
            continue;
        }
        const split = splitByTopology(bucket, SECTION_THRESHOLD);
        if (split && split.length > 1) {
            enforcedBuckets.push(...split);
        } else {
            enforcedBuckets.push(bucket);
        }
    }
    buckets = enforcedBuckets;

    const remapById = new Map<string, string>();
    for (let i = 0; i < buckets.length; i++) {
        const sectionNs = `section_${i + 1}_of_${buckets.length}`;
        sectionNamespaces.add(sectionNs);
        for (const node of buckets[i]) {
            remapById.set(node.id, sectionNs);
        }
    }

    const effectiveNodes = nodes.map((node) => {
        const sectionNs = remapById.get(node.id);
        if (!sectionNs) {
            return node;
        }
        return {
            ...node,
            namespace: node.namespace ? `${sectionNs}/${node.namespace}` : sectionNs,
        };
    });

    return { effectiveNodes, sectionNamespaces };
}

export function buildGraphIndex(graphId: string, nodes: SourceNode[]): GraphIndex {
    const { effectiveNodes: groupedNodes, opGroupNamespaces } = applyOpTypeGrouping(nodes);
    const { effectiveNodes, sectionNamespaces } = applyTopologySectioning(groupedNodes);

    // Sectioning prefixes namespaces with `section_K/...`, so op-type group
    // names like `stablehlo.reduce` need rewriting into the section paths they
    // actually live under. A single op-type group can split across multiple
    // sections — register each occurrence as its own synthetic namespace.
    const sectionedOpGroupNamespaces = new Set<string>();
    if (sectionNamespaces.size > 0 && opGroupNamespaces.size > 0) {
        for (const node of effectiveNodes) {
            if (!node.namespace) {
                continue;
            }
            for (const opGroupNs of opGroupNamespaces) {
                const marker = `/${opGroupNs}/`;
                const idx = node.namespace.indexOf(marker);
                if (idx > 0) {
                    sectionedOpGroupNamespaces.add(node.namespace.slice(0, idx + marker.length - 1));
                }
            }
        }
    }
    const effectiveOpGroupNamespaces = sectionNamespaces.size > 0 ? sectionedOpGroupNamespaces : opGroupNamespaces;
    const allSyntheticNamespaces = new Set([...sectionNamespaces, ...effectiveOpGroupNamespaces]);

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

    // Phase 3: force-register synthetic namespaces (topology sections + op-type groups)
    const preSyntheticNsSet = new Set(subgraphNamespaces);
    for (const syntheticNs of allSyntheticNamespaces) {
        if (!preSyntheticNsSet.has(syntheticNs)) {
            subgraphNamespaces.push(syntheticNs);
            preSyntheticNsSet.add(syntheticNs);
        }
        if (!anchorByNamespace.has(syntheticNs)) {
            // For op-type groups (e.g. "stablehlo.reduce"), nodes aren't directly
            // in the parent — they're in children like "stablehlo.reduce/stablehlo.reduce_48".
            // Collect all nodes whose namespace starts with this prefix.
            let candidateNodes = nodesByNamespace.get(syntheticNs) ?? [];
            if (candidateNodes.length === 0) {
                candidateNodes = effectiveNodes.filter(
                    (n) => n.namespace && (n.namespace === syntheticNs || n.namespace.startsWith(`${syntheticNs}/`)),
                );
            }
            candidateNodes.sort((a, b) => (nodeIndexById.get(a.id) ?? 0) - (nodeIndexById.get(b.id) ?? 0));
            const anchor = candidateNodes.find((n) => !anchorNamespaceByNodeId.has(n.id)) ?? candidateNodes[0];
            if (anchor) {
                anchorByNamespace.set(syntheticNs, anchor.id);
                anchorNamespaceByNodeId.set(anchor.id, syntheticNs);
            }
        }
    }
    if (allSyntheticNamespaces.size > 0) {
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
        sectionNamespaces: [...allSyntheticNamespaces],
    };
}
