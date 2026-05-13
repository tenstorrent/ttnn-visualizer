// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { SourceNode } from '../../src/components/mlir/mlirGraphTypes';
import { edge, makeNode } from './builders';

/**
 * Curated MLIR-graph scenarios used by the index-builder and graph-builder
 * suites. Each function exports a small (5-30 node) SourceNode[] that
 * exercises one specific invariant family — see PR_TEST_COVERAGE.md §3.2 /
 * §4.2 for the mapping.
 */

/** Flat: three ops with no namespaces, linear data flow. */
export function flat(): SourceNode[] {
    return [
        makeNode({ id: 'load', label: 'load' }),
        makeNode({ id: 'add', label: 'add', incomingEdges: [edge('load')] }),
        makeNode({ id: 'store', label: 'store', incomingEdges: [edge('add')] }),
    ];
}

/**
 * Single region: `stablehlo.reduce_0` containing an outer `stablehlo.reduce`
 * op plus an inner `stablehlo.add` op. The outer op is what the index
 * builder anchors the namespace to (its label matches the region base).
 */
export function singleRegion(): SourceNode[] {
    return [
        makeNode({ id: 'arg0', label: '%arg0' }),
        makeNode({
            id: 'reduce_outer',
            label: 'stablehlo.reduce',
            namespace: 'stablehlo.reduce_0',
            incomingEdges: [edge('arg0')],
        }),
        makeNode({
            id: 'add_inner',
            label: 'stablehlo.add',
            namespace: 'stablehlo.reduce_0',
            incomingEdges: [edge('reduce_outer')],
        }),
        makeNode({ id: 'return', label: 'stablehlo.return', namespace: 'stablehlo.reduce_0' }),
        makeNode({ id: 'sink', label: 'op', incomingEdges: [edge('reduce_outer')] }),
    ];
}

/**
 * Nested regions: three levels. `func.func_main` contains
 * `stablehlo.while_0`, which contains `stablehlo.add_0`. Each level has
 * its own outer op so anchoring is unambiguous.
 */
export function nestedRegions(): SourceNode[] {
    return [
        makeNode({ id: 'func_outer', label: 'func.func', namespace: 'func.func_main' }),
        makeNode({
            id: 'while_outer',
            label: 'stablehlo.while',
            namespace: 'func.func_main/stablehlo.while_0',
        }),
        makeNode({
            id: 'add_outer',
            label: 'stablehlo.add',
            namespace: 'func.func_main/stablehlo.while_0/stablehlo.add_0',
        }),
        makeNode({
            id: 'mul_inner',
            label: 'stablehlo.multiply',
            namespace: 'func.func_main/stablehlo.while_0/stablehlo.add_0',
            incomingEdges: [edge('add_outer')],
        }),
    ];
}

/**
 * `pinToGroupTop`: two candidates compete to be the anchor of `region_0`,
 * and the later-listed one carries `config.pinToGroupTop`. The pinned one
 * MUST win regardless of source-order index.
 */
export function pinToGroupTop(): SourceNode[] {
    return [
        makeNode({
            id: 'natural',
            label: 'region',
            namespace: 'region_0',
        }),
        makeNode({
            id: 'pinned',
            label: 'region',
            namespace: 'region_0',
            pinToGroupTop: true,
        }),
    ];
}

/**
 * Path-only ancestor: namespace `outer/inner` has direct nodes, but
 * `outer` itself has none. Phase 3 must descend into descendants to
 * assign `outer` an anchor.
 */
export function pathOnlyAncestor(): SourceNode[] {
    return [
        makeNode({ id: 'a', label: 'op', namespace: 'outer/inner' }),
        makeNode({ id: 'b', label: 'op', namespace: 'outer/inner', incomingEdges: [edge('a')] }),
    ];
}

/**
 * Below `SECTION_THRESHOLD` (1000 nodes): no sections should be created.
 * Keep this lean (50 nodes) — sectioning is gated by total node count.
 */
export function belowSectionThreshold(): SourceNode[] {
    const nodes: SourceNode[] = [];
    for (let i = 0; i < 50; i++) {
        nodes.push(makeNode({ id: `n${i}`, label: 'op', namespace: 'ns_0' }));
    }
    return nodes;
}

/**
 * Above `SECTION_THRESHOLD` (1000) AND above `splitByTopology` fallback
 * threshold (also SECTION_THRESHOLD). 1500 root-namespace ops, each in its
 * own singleton cluster. With no edges to chew on, Louvain returns
 * singletons and the builder falls back to topological bucket-splitting →
 * exactly 2 sections of ~1000 / ~500 nodes.
 */
export function aboveSectionThreshold(): SourceNode[] {
    return Array.from({ length: 1500 }, (_, i) => makeNode({ id: `n${i}`, label: 'op' }));
}

/**
 * Sectioning + a region cluster: 1500 ops where 500 live inside
 * `stablehlo.reduce_0` (a single cluster the partitioner treats as one
 * supernode). The remaining 1000 are root-level disconnected ops. The
 * region must stay in a single section — splitting it would orphan inner
 * ops from their outer-region anchor.
 */
export function aboveSectionThresholdWithRegion(): SourceNode[] {
    const nodes: SourceNode[] = [];
    nodes.push(makeNode({ id: 'reduce_outer', label: 'stablehlo.reduce', namespace: 'stablehlo.reduce_0' }));
    for (let i = 0; i < 499; i++) {
        nodes.push(
            makeNode({
                id: `reduce_inner_${i}`,
                label: 'stablehlo.add',
                namespace: 'stablehlo.reduce_0',
                incomingEdges: i === 0 ? [edge('reduce_outer')] : [edge(`reduce_inner_${i - 1}`)],
            }),
        );
    }
    for (let i = 0; i < 1000; i++) {
        nodes.push(makeNode({ id: `outside_${i}`, label: 'op' }));
    }
    return nodes;
}

/**
 * Visibility budget — two non-collapsible 50-node namespaces. Each
 * namespace's inner ops have unique labels so the "directNodeCount >= 2"
 * gate fires; Phase 2 promotes them to collapsible if budget is exceeded.
 * Returns 1000+ total to trip MAX_INITIAL_VISIBLE.
 */
export function visibilityBudgetTwoNamespaces(): SourceNode[] {
    const nodes: SourceNode[] = [];
    for (let i = 0; i < 600; i++) {
        nodes.push(makeNode({ id: `g1_${i}`, label: 'op', namespace: 'group_a' }));
    }
    for (let i = 0; i < 600; i++) {
        nodes.push(makeNode({ id: `g2_${i}`, label: 'op', namespace: 'group_b' }));
    }
    return nodes;
}

/**
 * Cross-namespace edge: producer in `producer_ns`, consumer in
 * `consumer_ns`. Used to exercise the rerouting logic when one side is
 * collapsed and the other expanded.
 */
export function crossNamespaceEdge(): SourceNode[] {
    return [
        makeNode({ id: 'p_outer', label: 'producer_ns', namespace: 'producer_ns' }),
        makeNode({
            id: 'p_inner',
            label: 'op',
            namespace: 'producer_ns',
            incomingEdges: [edge('p_outer')],
        }),
        makeNode({ id: 'c_outer', label: 'consumer_ns', namespace: 'consumer_ns' }),
        makeNode({
            id: 'c_inner',
            label: 'op',
            namespace: 'consumer_ns',
            incomingEdges: [edge('p_inner')],
        }),
    ];
}

/**
 * Internal-edge: all edges live strictly inside `region_0`. Verifies the
 * builder routes them through the group's internal edges, not as
 * top-level edges between the group's anchor and external nodes.
 */
export function internalEdgesOnly(): SourceNode[] {
    return [
        makeNode({ id: 'r_outer', label: 'region', namespace: 'region_0' }),
        makeNode({
            id: 'r_a',
            label: 'op',
            namespace: 'region_0',
            incomingEdges: [edge('r_outer')],
        }),
        makeNode({
            id: 'r_b',
            label: 'op',
            namespace: 'region_0',
            incomingEdges: [edge('r_a')],
        }),
        makeNode({
            id: 'r_c',
            label: 'op',
            namespace: 'region_0',
            incomingEdges: [edge('r_b')],
        }),
    ];
}

/**
 * Multi-edge: same producer/consumer pair connected by TWO edges through
 * different output/input ports. The builder dedupes these in the rendered
 * graph (a single edge with combined label).
 */
export function multiPortEdge(): SourceNode[] {
    return [
        makeNode({
            id: 'producer',
            label: 'op',
            outputsMetadata: [
                { id: '0', attrs: [] },
                { id: '1', attrs: [] },
            ],
        }),
        makeNode({
            id: 'consumer',
            label: 'op',
            incomingEdges: [
                edge('producer', { outputId: '0', inputId: '0' }),
                edge('producer', { outputId: '1', inputId: '1' }),
            ],
        }),
    ];
}

/**
 * Block-arg inputs in a `<ns>/Inputs` subnamespace, plus a region return op.
 * Exercises `namespaceInputByNamespace[ns]` ordering by `%argN` and
 * `namespaceReturnNodeByNamespace[ns]` (latest-by-index) population.
 */
export function regionWithInputsAndReturn(): SourceNode[] {
    return [
        // Inputs live in the conventional `<ns>/Inputs` subnamespace.
        makeNode({ id: 'arg2', label: '%arg2', namespace: 'fn_0/Inputs' }),
        makeNode({ id: 'arg0', label: '%arg0', namespace: 'fn_0/Inputs' }),
        makeNode({ id: 'arg1', label: '%arg1', namespace: 'fn_0/Inputs' }),
        // The region itself.
        makeNode({ id: 'fn_outer', label: 'fn', namespace: 'fn_0' }),
        // Two return candidates — the latest-by-index one wins.
        makeNode({
            id: 'return_first',
            label: 'stablehlo.return',
            namespace: 'fn_0',
            incomingEdges: [edge('fn_outer')],
        }),
        makeNode({
            id: 'return_last',
            label: 'stablehlo.return',
            namespace: 'fn_0',
            incomingEdges: [edge('return_first')],
        }),
    ];
}
