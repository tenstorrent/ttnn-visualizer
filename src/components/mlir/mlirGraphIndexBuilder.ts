// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/* eslint-disable no-continue */
import { getParentNamespace, getShortName, pushTo } from './mlirGraphHelpers';
import { partitionByCommunity } from './mlirGraphPartitioner';
import type { GraphIndex, SourceNode } from './mlirGraphTypes';

const getRegionBaseOpLabel = (namespace: string): string => getShortName(namespace).replace(/_\d+$/, '');

const getNodeAttrValue = (node: SourceNode, key: string): string | undefined =>
    node.attrs.find((attr) => attr.key === key)?.value;

const getNamespaceOrdinal = (namespace: string): number => {
    const leaf = getShortName(namespace);
    const match = leaf.match(/_(\d+)$/);
    return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
};

/** Sort namespaces by their `_K` suffix (ascending), tiebreak alphabetically. */
const byNamespaceOrdinal = (a: string, b: string): number => {
    const ord = getNamespaceOrdinal(a) - getNamespaceOrdinal(b);
    return ord !== 0 ? ord : a.localeCompare(b);
};

/**
 * Sort `pinToGroupTop` candidates first, then by their original index in the
 * source-node array. Used to pick a stable anchor for each namespace.
 */
const byPinnedThenIndex =
    (nodeIndexById: Map<string, number>) =>
    (a: SourceNode, b: SourceNode): number => {
        const aPinned = a.config?.pinToGroupTop ? 1 : 0;
        const bPinned = b.config?.pinToGroupTop ? 1 : 0;
        if (aPinned !== bPinned) {
            return bPinned - aPinned;
        }
        return (nodeIndexById.get(a.id) ?? 0) - (nodeIndexById.get(b.id) ?? 0);
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
            pushTo(outgoing, edge.sourceNodeId, node.id);
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

/**
 * Section the full node set into ~1000-node communities. Operates on ALL nodes
 * (not just namespace-less ones) so even fully-namespaced graphs get grouped
 * into target-sized communities. A node's existing namespace, if any, is
 * preserved as a child path under its section: `section_K_of_N/<original>`.
 *
 * IMPORTANT: partitioning is done at the *cluster* level, where every top-level
 * namespace segment (e.g. `stablehlo.reduce_88` and all of its inner ops like
 * `stablehlo.reduce_88/Inputs`) is one indivisible cluster. Without this,
 * Louvain would happily separate a region's outer op from its inner body if
 * they have different connectivity, leaving the user with an "expanded group
 * that has no connections" because the connection-bearing outer op ended up in
 * a sibling section. Rootless ops (no source namespace) act as singleton
 * clusters and partition individually as before.
 */
function applyTopologySectioning(nodes: SourceNode[]): {
    effectiveNodes: SourceNode[];
    sectionNamespaces: Set<string>;
} {
    const sectionNamespaces = new Set<string>();

    if (nodes.length <= SECTION_THRESHOLD) {
        return { effectiveNodes: nodes, sectionNamespaces };
    }

    const clusterKeyOf = (node: SourceNode): string => {
        if (!node.namespace) {
            return `node:${node.id}`;
        }
        return `ns:${node.namespace.split('/')[0]}`;
    };

    const clusterMembers = new Map<string, SourceNode[]>();
    const clusterKeyByNodeId = new Map<string, string>();
    for (const node of nodes) {
        const key = clusterKeyOf(node);
        clusterKeyByNodeId.set(node.id, key);
        pushTo(clusterMembers, key, node);
    }

    // Build supernode SourceNodes for the partitioner. One supernode per
    // cluster; intra-cluster edges are dropped (irrelevant for partitioning),
    // inter-cluster edges accumulate as weighted multi-edges that Louvain
    // collapses internally.
    const supernodeIdForKey = (key: string): string => `super:${key}`;
    const supernodes: SourceNode[] = [];
    for (const key of clusterMembers.keys()) {
        supernodes.push({
            id: supernodeIdForKey(key),
            label: key,
            namespace: '',
            attrs: [],
            incomingEdges: [],
            outputsMetadata: [],
            config: null,
        });
    }
    const supernodeById = new Map(supernodes.map((sn) => [sn.id, sn]));

    for (const node of nodes) {
        const tgtKey = clusterKeyByNodeId.get(node.id);
        if (!tgtKey) {
            continue;
        }
        const tgtSn = supernodeById.get(supernodeIdForKey(tgtKey));
        if (!tgtSn) {
            continue;
        }
        for (const edge of node.incomingEdges ?? []) {
            const srcKey = clusterKeyByNodeId.get(edge.sourceNodeId);
            if (!srcKey || srcKey === tgtKey) {
                continue;
            }
            tgtSn.incomingEdges.push({
                sourceNodeId: supernodeIdForKey(srcKey),
                sourceNodeOutputId: '0',
                targetNodeInputId: '0',
            });
        }
    }

    // Target K is computed on UNDERLYING node count (what the user actually
    // sees), not supernode count. Bucket size limits below are also expressed
    // in underlying nodes for the same reason.
    const targetK = Math.max(2, Math.ceil(nodes.length / SECTION_THRESHOLD));

    // Partitioner operates on supernodes. Pass threshold=0 because the
    // supernode count can legitimately be smaller than SECTION_THRESHOLD even
    // when underlying-node count exceeds it (e.g. graph composed entirely of
    // many small regions). We still want to section.
    let supernodeBuckets = partitionByCommunity(supernodes, 0, {
        maxSize: COMMUNITY_MAX_SIZE,
        minSize: COMMUNITY_MIN_SIZE,
        targetK,
        resolution: COMMUNITY_RESOLUTION,
        maxDepth: 1,
    });

    if (!supernodeBuckets || supernodeBuckets.length <= 1) {
        supernodeBuckets = splitByTopology(supernodes, SECTION_THRESHOLD);
    }
    if (!supernodeBuckets || supernodeBuckets.length <= 1) {
        return { effectiveNodes: nodes, sectionNamespaces };
    }

    // Expand each supernode bucket back into its underlying SourceNodes.
    const expandSupernodeBucket = (snBucket: SourceNode[]): SourceNode[] => {
        const out: SourceNode[] = [];
        for (const sn of snBucket) {
            const key = sn.id.replace(/^super:/, '');
            const members = clusterMembers.get(key);
            if (members) {
                out.push(...members);
            }
        }
        return out;
    };

    // Compute underlying-node bucket sizes from the supernode partition.
    let buckets: SourceNode[][] = supernodeBuckets.map(expandSupernodeBucket);

    // Safety net: split oversized buckets by topology. Operates on the
    // supernode bucket so cluster integrity is preserved (a region cannot be
    // split across resulting sub-buckets). Re-runs the per-bucket
    // splitByTopology at the supernode level then re-expands.
    const enforcedBuckets: SourceNode[][] = [];
    for (let i = 0; i < buckets.length; i++) {
        if (buckets[i].length <= COMMUNITY_MAX_SIZE) {
            enforcedBuckets.push(buckets[i]);
            continue;
        }
        const snBucket = supernodeBuckets[i];
        // Threshold = supernode count that yields ≤ COMMUNITY_MAX_SIZE
        // underlying nodes per sub-bucket. Density = underlying / supernode
        // for this oversized bucket.
        const density = buckets[i].length / snBucket.length;
        const snThreshold = Math.max(1, Math.floor(SECTION_THRESHOLD / Math.max(density, 1)));
        const snSplit = splitByTopology(snBucket, snThreshold);
        if (snSplit && snSplit.length > 1) {
            for (const subSn of snSplit) {
                enforcedBuckets.push(expandSupernodeBucket(subSn));
            }
        } else {
            enforcedBuckets.push(buckets[i]);
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
    // Source-MLIR namespaces are honoured as-is. Only topology sectioning is
    // applied below to keep large flat graphs renderable; sections wrap at the
    // root level and never disturb the inner namespace structure.
    const { effectiveNodes, sectionNamespaces } = applyTopologySectioning(nodes);
    const allSyntheticNamespaces = new Set(sectionNamespaces);

    const nodeIndexById = new Map(effectiveNodes.map((n, idx) => [n.id, idx]));
    const nodesByNamespace = new Map<string, SourceNode[]>();
    const labelsByNamespace = new Map<string, Set<string>>();
    const namespacesWithChildren = new Set<string>();

    for (const node of effectiveNodes) {
        if (!node.namespace) {
            continue;
        }
        const existingLabels = labelsByNamespace.get(node.namespace);
        if (existingLabels) {
            existingLabels.add(node.label);
        } else {
            labelsByNamespace.set(node.namespace, new Set([node.label]));
        }
        pushTo(nodesByNamespace, node.namespace, node);

        const segments = node.namespace.split('/');
        for (let i = 1; i < segments.length; i++) {
            namespacesWithChildren.add(segments.slice(0, i).join('/'));
        }
    }

    // Honor namespaces: every distinct namespace (including ancestors that only
    // exist as path segments like "func.func_main" with children but no direct
    // nodes) becomes a collapsible subgroup, collapsed by default. The original
    // MLIR region pattern (namespace contains a node labeled with the base op,
    // e.g. "stablehlo.reduce_8" → contains "stablehlo.reduce") is still detected
    // first to preserve outer-op anchoring; non-region namespaces fall through
    // and are anchored by their first non-claimed inner node.
    const allNamespaces = new Set<string>([...nodesByNamespace.keys(), ...namespacesWithChildren]);
    const collapsibleNamespaces: string[] = [];
    for (const namespace of allNamespaces) {
        const directNodeCount = nodesByNamespace.get(namespace)?.length ?? 0;
        const hasChildren = namespacesWithChildren.has(namespace);
        if (directNodeCount >= 2 || hasChildren) {
            collapsibleNamespaces.push(namespace);
        }
    }

    const subgraphNamespaces = [...collapsibleNamespaces].sort(byNamespaceOrdinal);

    const anchorComparator = byPinnedThenIndex(nodeIndexById);
    const anchorByNamespace = new Map<string, string>();
    const anchorNamespaceByNodeId = new Map<string, string>();
    for (const namespace of subgraphNamespaces) {
        const expectedLabel = getRegionBaseOpLabel(namespace);
        const candidates = (nodesByNamespace.get(namespace) ?? []).filter((node) => node.label === expectedLabel);
        candidates.sort(anchorComparator);
        let anchor = candidates.find((n) => !anchorNamespaceByNodeId.has(n.id));
        if (!anchor) {
            // Fallback for non-region namespaces (e.g. "Inputs", "func.func_main"):
            // pick the first direct node whose id isn't already an anchor for a
            // deeper namespace. If the namespace has no direct nodes (path-only
            // ancestor), Phase 3 below will assign an anchor by descending into
            // descendants.
            const directNodes = (nodesByNamespace.get(namespace) ?? []).slice().sort(anchorComparator);
            anchor = directNodes.find((n) => !anchorNamespaceByNodeId.has(n.id));
        }
        if (!anchor) {
            continue;
        }
        anchorByNamespace.set(namespace, anchor.id);
        anchorNamespaceByNodeId.set(anchor.id, namespace);
    }

    // Phase 3: force-register synthetic topology-section namespaces, and assign
    // anchors to any path-only ancestor namespaces that have children but no
    // direct nodes (e.g. "func.func_main" in graphs where every op also lives
    // in a deeper region). Descend into descendants to find an anchor in those
    // cases.
    const preSyntheticNsSet = new Set(subgraphNamespaces);
    for (const syntheticNs of allSyntheticNamespaces) {
        if (!preSyntheticNsSet.has(syntheticNs)) {
            subgraphNamespaces.push(syntheticNs);
            preSyntheticNsSet.add(syntheticNs);
        }
    }
    for (const namespace of subgraphNamespaces) {
        if (anchorByNamespace.has(namespace)) {
            continue;
        }
        const candidateNodes = effectiveNodes.filter(
            (n) => n.namespace && (n.namespace === namespace || n.namespace.startsWith(`${namespace}/`)),
        );
        candidateNodes.sort((a, b) => (nodeIndexById.get(a.id) ?? 0) - (nodeIndexById.get(b.id) ?? 0));
        const anchor = candidateNodes.find((n) => !anchorNamespaceByNodeId.has(n.id)) ?? candidateNodes[0];
        if (anchor) {
            anchorByNamespace.set(namespace, anchor.id);
            anchorNamespaceByNodeId.set(anchor.id, namespace);
        }
    }
    if (allSyntheticNamespaces.size > 0) {
        subgraphNamespaces.sort(byNamespaceOrdinal);
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
            pushTo(uncollapsedByNamespace, node.namespace, node);
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
                const arr = uncollapsedByParent.get(parentNs);
                if (arr) {
                    arr.push(...group);
                } else {
                    uncollapsedByParent.set(parentNs, [...group]);
                }
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

        subgraphNamespaces.sort(byNamespaceOrdinal);
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
            pushTo(returnCandidatesByNamespace, node.namespace, node);
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
            // A node is an "input" of `ancestor` only if it structurally
            // belongs to that ancestor's input boundary:
            //   - it lives directly in the ancestor's namespace AND is a `%argN`
            //     block argument, OR
            //   - it lives under the ancestor's `/Inputs` subnamespace.
            // Earlier the rule was the much looser `isArg || startsWith /Inputs`
            // which credited every `%argN` to every ancestor in its chain,
            // including synthetic topology sections that have no inputs of
            // their own. The downstream edge-rerouting then redirected
            // cross-section edges to those phantom "section inputs" and the
            // real edge to the inner op disappeared.
            const inputsPrefix = `${ancestor}/Inputs`;
            const inInputsSubgraph = node.namespace === inputsPrefix || node.namespace.startsWith(`${inputsPrefix}/`);
            const isDirectArgChild = isArg && node.namespace === ancestor;
            if (isDirectArgChild || inInputsSubgraph) {
                pushTo(inputNodesByNamespace, ancestor, node);
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
