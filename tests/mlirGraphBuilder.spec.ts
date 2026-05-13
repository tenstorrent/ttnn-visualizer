// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { expect, test } from 'vitest';
import { buildVisibleGraph } from '../src/components/mlir/mlirGraphBuilder';
import { buildGraphIndex } from '../src/components/mlir/mlirGraphIndexBuilder';
import type { BuiltGraph, WorkerEdge, WorkerNode } from '../src/components/mlir/mlirGraphTypes';
import { assertBuiltGraphInvariants } from './mlirFixtures/invariants';
import {
    aboveSectionThreshold,
    crossNamespaceEdge,
    flat,
    internalEdgesOnly,
    multiPortEdge,
    nestedRegions,
    pathOnlyAncestor,
    regionWithInputsAndReturn,
    singleRegion,
} from './mlirFixtures/scenarios';

/** Convenience: build the index + visible graph, asserting cross-cutting invariants. */
function build(nodes: ReturnType<typeof flat>, expanded: string[] = []): BuiltGraph {
    const index = buildGraphIndex('test', nodes);
    const graph = buildVisibleGraph(index, expanded);
    assertBuiltGraphInvariants(graph);
    return graph;
}

function getOpNodes(graph: BuiltGraph): WorkerNode[] {
    return graph.nodes.filter((n) => n.data.kind === 'op');
}

function getGroupNodes(graph: BuiltGraph): WorkerNode[] {
    return graph.nodes.filter((n) => n.data.kind === 'group');
}

function findEdgeBetween(graph: BuiltGraph, source: string, target: string): WorkerEdge | undefined {
    return graph.edges.find((e) => e.source === source && e.target === target);
}

// 4.2.1 — flat graph: every node is rendered as an op node, no group nodes.
test('buildVisibleGraph on a flat graph renders one op node per source node and no groups', () => {
    const graph = build(flat());

    expect(getGroupNodes(graph)).toHaveLength(0);
    expect(
        getOpNodes(graph)
            .map((n) => n.id)
            .sort(),
    ).toEqual(['add', 'load', 'store']);
    expect(graph.edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual(['add->store', 'load->add']);
});

// 4.2.2 — single region, all collapsed: only the anchor (outer op) is visible,
// inner nodes are hidden. Edge from outside still attaches to the anchor.
test('buildVisibleGraph on a collapsed region renders only the anchor op and hides inner nodes', () => {
    const graph = build(singleRegion());

    const opIds = new Set(getOpNodes(graph).map((n) => n.id));
    expect(opIds.has('reduce_outer')).toBe(true);
    expect(opIds.has('add_inner')).toBe(false);
    expect(opIds.has('return')).toBe(false);

    // Edge from arg0 → reduce_outer is preserved.
    expect(findEdgeBetween(graph, 'arg0', 'reduce_outer')).toBeDefined();
    // Edge from reduce_outer → sink is preserved.
    expect(findEdgeBetween(graph, 'reduce_outer', 'sink')).toBeDefined();
});

// 4.2.3 — single region, expanded: group node appears as `group:<ns>`, inner
// nodes are visible, and parentId points at the group.
test('buildVisibleGraph on an expanded region renders a group node containing the inner ops', () => {
    const graph = build(singleRegion(), ['stablehlo.reduce_0']);

    const groupIds = new Set(getGroupNodes(graph).map((n) => n.id));
    expect(groupIds.has('group:stablehlo.reduce_0')).toBe(true);

    const innerOp = graph.nodes.find((n) => n.id === 'add_inner')!;
    expect(innerOp).toBeDefined();
    expect(innerOp.parentId).toBe('group:stablehlo.reduce_0');
});

// 4.2.4 — cross-namespace edge with BOTH endpoints collapsed: edge runs
// between anchors (one per namespace), not between hidden inner ops.
test('buildVisibleGraph reroutes a cross-namespace edge to anchor nodes when both ends are collapsed', () => {
    const graph = build(crossNamespaceEdge());

    // p_inner (inside producer_ns) → c_inner (inside consumer_ns). Both
    // collapsed, so edge must run anchor → anchor.
    expect(findEdgeBetween(graph, 'p_outer', 'c_outer')).toBeDefined();
    // The hidden endpoints must NOT appear as edge endpoints.
    expect(findEdgeBetween(graph, 'p_inner', 'c_inner')).toBeUndefined();
});

// 4.2.5 — cross-namespace edge with both ends EXPANDED: leaf-to-leaf edge.
test('buildVisibleGraph routes a cross-namespace edge between visible inner ops when both ends are expanded', () => {
    const graph = build(crossNamespaceEdge(), ['producer_ns', 'consumer_ns']);

    expect(findEdgeBetween(graph, 'p_inner', 'c_inner')).toBeDefined();
});

// 4.2.6 — internal-only edges: when the namespace is expanded, all edges
// inside it appear as edges between inner ops, not as group→group edges.
test('buildVisibleGraph keeps purely internal edges inside the expanded group', () => {
    const graph = build(internalEdgesOnly(), ['region_0']);

    // r_outer → r_a → r_b → r_c, all leaf-to-leaf.
    for (const [src, tgt] of [
        ['r_outer', 'r_a'],
        ['r_a', 'r_b'],
        ['r_b', 'r_c'],
    ] as const) {
        expect(findEdgeBetween(graph, src, tgt), `missing edge ${src}->${tgt}`).toBeDefined();
    }

    // No self-edge on the group node from the dedup pass.
    expect(findEdgeBetween(graph, 'group:region_0', 'group:region_0')).toBeUndefined();
});

// 4.2.7 — multi-port: two edges between the same producer/consumer pair on
// different ports must NOT produce duplicate rendered edges. The builder
// dedupes by source/target pair.
test('buildVisibleGraph dedupes multiple edges between the same producer and consumer pair', () => {
    const graph = build(multiPortEdge());

    const between = graph.edges.filter((e) => e.source === 'producer' && e.target === 'consumer');
    expect(between).toHaveLength(1);
});

// 4.2.8 — nested expansion: parentId chain is honoured for each level.
test('buildVisibleGraph chains parentId for nested expanded namespaces', () => {
    const graph = build(nestedRegions(), [
        'func.func_main',
        'func.func_main/stablehlo.while_0',
        'func.func_main/stablehlo.while_0/stablehlo.add_0',
    ]);

    // Inner-most leaf node points at the innermost group.
    const mulInner = graph.nodes.find((n) => n.id === 'mul_inner')!;
    expect(mulInner.parentId).toBe('group:func.func_main/stablehlo.while_0/stablehlo.add_0');

    // The innermost group's parentId points at the middle group.
    const innerGroup = graph.nodes.find((n) => n.id === 'group:func.func_main/stablehlo.while_0/stablehlo.add_0')!;
    expect(innerGroup.parentId).toBe('group:func.func_main/stablehlo.while_0');

    // Middle group's parentId points at the outer group.
    const middleGroup = graph.nodes.find((n) => n.id === 'group:func.func_main/stablehlo.while_0')!;
    expect(middleGroup.parentId).toBe('group:func.func_main');
});

// 4.2.9 — group nodes expose nodeCount + displayName for header rendering.
test('buildVisibleGraph populates nodeCount and displayName on group headers', () => {
    const graph = build(singleRegion(), ['stablehlo.reduce_0']);

    const group = graph.nodes.find((n) => n.id === 'group:stablehlo.reduce_0')!;
    expect(group.data.kind).toBe('group');
    expect(group.data.displayName).toBeDefined();
    expect(typeof group.data.nodeCount).toBe('number');
    expect(group.data.nodeCount!).toBeGreaterThan(0);
});

// 4.2.10 — section group headers display "section X of Y" with `groupKind:section`.
test('buildVisibleGraph labels section groups with section kind and humanised display name', () => {
    const index = buildGraphIndex('section', aboveSectionThreshold());
    const someSection = index.sectionNamespaces[0];
    expect(someSection).toBeDefined();

    const graph = buildVisibleGraph(index, []);
    assertBuiltGraphInvariants(graph);

    // Walk the group nodes for the section namespace and check its props.
    const sectionGroup = graph.nodes.find((n) => n.data.namespace === someSection && n.data.kind === 'group');
    // The section is collapsed by default — only its anchor op renders, not a group.
    // Expanding it should produce a group node with section metadata.
    const expandedGraph = buildVisibleGraph(index, [someSection]);
    assertBuiltGraphInvariants(expandedGraph);
    const expandedGroup = expandedGraph.nodes.find((n) => n.data.namespace === someSection && n.data.kind === 'group');
    expect(expandedGroup, `no group node for section namespace ${someSection}`).toBeDefined();
    expect(expandedGroup!.data.groupKind).toBe('section');
    expect(expandedGroup!.data.displayName).toMatch(/^section \d+ of \d+$/);
    // sectionGroup (when collapsed) is intentionally undefined.
    expect(sectionGroup).toBeUndefined();
});

// 4.2.11 — dagre layout produces distinct y-coordinates for a chain of ops.
test('buildVisibleGraph runs dagre layout and assigns distinct positions per rank', () => {
    const graph = build(flat());

    const positions = getOpNodes(graph).map((n) => n.position.y);
    const uniqueYs = new Set(positions);
    // load -> add -> store: three ranks, three distinct y-positions.
    expect(uniqueYs.size).toBe(3);
});

// 4.2.12 — large graph: above DAGRE_NODE_LIMIT (2000) doesn't crash, all
// invariants still hold. Uses the high-density density fallback path.
test('buildVisibleGraph handles graphs larger than the dagre limit without violating invariants', () => {
    // 2500 root-level ops, no edges. Each one will be its own visible op node.
    const nodes = Array.from({ length: 2500 }, (_, i) => ({
        id: `big_${i}`,
        label: 'op',
        namespace: '',
        attrs: [],
        incomingEdges: [],
        outputsMetadata: [],
        config: null,
    }));
    const index = buildGraphIndex('big', nodes);

    // Expand every section so all 2500 ops render as direct children.
    const graph = buildVisibleGraph(index, index.sectionNamespaces);
    assertBuiltGraphInvariants(graph);

    // Every input op must be present in the rendered graph (no silent drops).
    const renderedOpIds = new Set(getOpNodes(graph).map((n) => n.id));
    for (let i = 0; i < 2500; i++) {
        expect(renderedOpIds.has(`big_${i}`), `op big_${i} missing from rendered graph`).toBe(true);
    }
});

// 4.2.13 — every edge carries the canonical ARROW_MARKER shape (invariant
// already inside `assertBuiltGraphInvariants`, but pin a smoke test here too).
test('buildVisibleGraph emits the canonical arrow marker on every edge', () => {
    const graph = build(flat());

    expect(graph.edges.length).toBeGreaterThan(0);
    for (const e of graph.edges) {
        expect(e.markerEnd).toEqual({ type: 'arrowclosed', height: 20, width: 20 });
    }
});

// 4.2.14 — determinism: same index + same expansion list → identical built graph.
test('buildVisibleGraph is deterministic for identical inputs', () => {
    const index = buildGraphIndex('det', nestedRegions());
    const expansion = ['func.func_main', 'func.func_main/stablehlo.while_0'];

    const a = buildVisibleGraph(index, expansion);
    const b = buildVisibleGraph(index, expansion);
    assertBuiltGraphInvariants(a);
    assertBuiltGraphInvariants(b);

    // Compare structurally: same ids and same edges. Positions are produced
    // by dagre which is deterministic for identical inputs.
    expect(a.nodes.map((n) => n.id).sort()).toEqual(b.nodes.map((n) => n.id).sort());
    expect(a.edges.map((e) => e.id).sort()).toEqual(b.edges.map((e) => e.id).sort());
});

// Bonus: path-only ancestor (namespace with no direct nodes, only descendants)
// can be expanded without crashing the builder.
test('buildVisibleGraph expands a path-only ancestor namespace without losing descendants', () => {
    const graph = build(pathOnlyAncestor(), ['outer', 'outer/inner']);

    const opIds = new Set(getOpNodes(graph).map((n) => n.id));
    expect(opIds.has('a')).toBe(true);
    expect(opIds.has('b')).toBe(true);

    // The leaf ops should parent up to the inner group, which parents up to
    // the outer group.
    const a = graph.nodes.find((n) => n.id === 'a')!;
    expect(a.parentId).toBe('group:outer/inner');
    const innerGroup = graph.nodes.find((n) => n.id === 'group:outer/inner')!;
    expect(innerGroup.parentId).toBe('group:outer');
});

// Bonus: region inputs / return op — collapsed region anchors edges to the
// outer op, even for edges from `<ns>/Inputs` and to the return op.
test('buildVisibleGraph reroutes return-op outgoing edges through the collapsed region anchor', () => {
    const graph = build(regionWithInputsAndReturn());

    // fn_0 is collapsed by default. Any edge originating inside fn_0 must be
    // rewritten to leave from fn_outer (the anchor).
    for (const e of graph.edges) {
        // No edge should originate from a node that's hidden inside the
        // collapsed region.
        expect(e.source).not.toBe('arg0');
        expect(e.source).not.toBe('arg1');
        expect(e.source).not.toBe('arg2');
        expect(e.source).not.toBe('return_first');
        expect(e.source).not.toBe('return_last');
    }
});

// Bonus: every group node's data.namespace matches the namespace encoded
// in its id (`group:<ns>`). Phase-split refactors must not desync these.
test('buildVisibleGraph keeps group node data.namespace consistent with id', () => {
    const graph = build(nestedRegions(), ['func.func_main', 'func.func_main/stablehlo.while_0']);

    for (const group of getGroupNodes(graph)) {
        expect(group.id.startsWith('group:')).toBe(true);
        const expectedNs = group.id.slice('group:'.length);
        expect(group.data.namespace).toBe(expectedNs);
    }
});
