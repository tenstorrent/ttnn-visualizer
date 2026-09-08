// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { expect, test } from 'vitest';
import { buildGraphIndex } from '../src/components/mlir/mlirGraphIndexBuilder';
import { edge, makeNode } from './mlirFixtures/builders';
import { assertIndexInvariants } from './mlirFixtures/invariants';
import {
    aboveSectionThreshold,
    aboveSectionThresholdWithRegion,
    belowSectionThreshold,
    flat,
    nestedRegions,
    pathOnlyAncestor,
    pinToGroupTop,
    regionWithInputsAndReturn,
    singleRegion,
    visibilityBudgetTwoNamespaces,
} from './mlirFixtures/scenarios';

// 3.2.1 — flat graph: no namespaces.
test('buildGraphIndex on a flat graph produces no subgraph namespaces', () => {
    const index = buildGraphIndex('flat', flat());
    assertIndexInvariants(index);

    expect(index.subgraphNamespaces).toHaveLength(0);
    expect(index.sectionNamespaces).toHaveLength(0);
    expect(Object.keys(index.anchorByNamespace)).toHaveLength(0);
    for (const n of index.nodes) {
        expect(index.containingNamespacesByNodeId[n.id]).toEqual([]);
    }
});

// 3.2.2 — single region: outer op (matching base label) anchors the namespace.
test('buildGraphIndex anchors a region to its outer op (label == region base name)', () => {
    const index = buildGraphIndex('singleRegion', singleRegion());
    assertIndexInvariants(index);

    expect(index.subgraphNamespaces).toContain('stablehlo.reduce_0');
    expect(index.anchorByNamespace['stablehlo.reduce_0']).toBe('reduce_outer');
    expect(index.anchorNamespaceByNodeId.reduce_outer).toBe('stablehlo.reduce_0');
});

// 3.2.3 — nested regions: 3-level nesting reflected in containingNamespacesByNodeId.
test('buildGraphIndex nests containing namespaces shallowest-first for deeply-nested ops', () => {
    const index = buildGraphIndex('nested', nestedRegions());
    assertIndexInvariants(index);

    // All three levels should be subgraph namespaces.
    const expected = [
        'func.func_main',
        'func.func_main/stablehlo.while_0',
        'func.func_main/stablehlo.while_0/stablehlo.add_0',
    ];
    for (const ns of expected) {
        expect(index.subgraphNamespaces).toContain(ns);
    }

    // mul_inner lives 3 levels deep; its containing list is shallow-to-deep.
    expect(index.containingNamespacesByNodeId.mul_inner).toEqual(expected);
});

// 3.2.4 — `pinToGroupTop` config wins anchor selection.
test('buildGraphIndex prefers a pinToGroupTop node over the natural anchor', () => {
    const index = buildGraphIndex('pinned', pinToGroupTop());
    assertIndexInvariants(index);

    expect(index.anchorByNamespace.region_0).toBe('pinned');
    expect(index.anchorNamespaceByNodeId.pinned).toBe('region_0');
    // The displaced "natural" candidate must NOT also claim the namespace.
    expect(index.anchorNamespaceByNodeId.natural).toBeUndefined();
});

// 3.2.5 — path-only ancestor namespace still gets an anchor (Phase 3 descent).
test('buildGraphIndex assigns an anchor to path-only ancestor namespaces by descending', () => {
    const index = buildGraphIndex('pathOnly', pathOnlyAncestor());
    assertIndexInvariants(index);

    expect(index.subgraphNamespaces).toContain('outer');
    expect(index.subgraphNamespaces).toContain('outer/inner');
    // `outer` has no direct nodes — its anchor must descend into `outer/inner`.
    const outerAnchor = index.anchorByNamespace.outer;
    expect(outerAnchor === 'a' || outerAnchor === 'b').toBe(true);
});

// 3.2.6 — node count below SECTION_THRESHOLD: no sections created.
test('buildGraphIndex skips sectioning when node count is below threshold', () => {
    const index = buildGraphIndex('belowThreshold', belowSectionThreshold());
    assertIndexInvariants(index);

    expect(index.sectionNamespaces).toHaveLength(0);
    // The original namespace stays unprefixed.
    expect(index.subgraphNamespaces.some((ns) => ns.startsWith('section_'))).toBe(false);
});

// 3.2.7 — node count above SECTION_THRESHOLD: sections created.
test('buildGraphIndex sections large graphs and prefixes namespaces with section_K_of_N', () => {
    const index = buildGraphIndex('aboveThreshold', aboveSectionThreshold());
    assertIndexInvariants(index);

    expect(index.sectionNamespaces.length).toBeGreaterThan(1);
    // Every section namespace is shape `section_<idx>_of_<count>`.
    for (const sectionNs of index.sectionNamespaces) {
        expect(sectionNs).toMatch(/^section_\d+_of_\d+$/);
    }
});

// 3.2.8 — sectioning preserves region cluster integrity.
test('buildGraphIndex keeps a region and its inner ops in the same section', () => {
    const index = buildGraphIndex('regionInSection', aboveSectionThresholdWithRegion());
    assertIndexInvariants(index);

    expect(index.sectionNamespaces.length).toBeGreaterThan(1);

    // Every node carrying the original `stablehlo.reduce_0` namespace must
    // share a section prefix. Pull the unique set of `section_*` prefixes
    // from those nodes' containingNamespacesByNodeId chain.
    const reduceNodeIds = ['reduce_outer', ...Array.from({ length: 549 }, (_, i) => `reduce_inner_${i}`)];
    const sectionsHit = new Set<string>();
    for (const id of reduceNodeIds) {
        const chain = index.containingNamespacesByNodeId[id] ?? [];
        const section = chain.find((ns) => ns.startsWith('section_'));
        if (section) {
            sectionsHit.add(section);
        }
    }
    expect(sectionsHit.size, 'region cluster split across multiple sections').toBe(1);
});

// 3.2.9 — visibility budget: large namespaces are promoted to collapsible.
test('buildGraphIndex promotes large namespaces to collapsible when initial-visible budget is exceeded', () => {
    const index = buildGraphIndex('budgetNamespaces', visibilityBudgetTwoNamespaces());
    assertIndexInvariants(index);

    // Both 600-node namespaces should now appear as collapsibles so the
    // initial render stays under MAX_INITIAL_VISIBLE.
    expect(index.subgraphNamespaces).toContain('group_a');
    expect(index.subgraphNamespaces).toContain('group_b');
    expect(index.anchorByNamespace.group_a).toBeDefined();
    expect(index.anchorByNamespace.group_b).toBeDefined();
});

// 3.2.10 — `namespaceInputByNamespace[ns]` is sorted by `%argN` index.
test('buildGraphIndex orders namespace inputs by %argN index, not by source order', () => {
    const index = buildGraphIndex('regionIO', regionWithInputsAndReturn());
    assertIndexInvariants(index);

    const inputs = index.namespaceInputByNamespace.fn_0;
    expect(inputs).toEqual(['arg0', 'arg1', 'arg2']);
});

// 3.2.11 — `namespaceReturnNodeByNamespace[ns]` picks the latest by node index.
test('buildGraphIndex picks the latest return op (by original index) when multiple exist', () => {
    const index = buildGraphIndex('regionIO', regionWithInputsAndReturn());
    assertIndexInvariants(index);

    expect(index.namespaceReturnNodeByNamespace.fn_0).toBe('return_last');
});

// 3.2.12 — `outerNamespaceByNodeId` keys are outer ops in the parent namespace.
test('buildGraphIndex links the outer-region op to its inner namespace', () => {
    const nodes = [
        makeNode({ id: 'outer', label: 'stablehlo.reduce', namespace: 'parent' }),
        makeNode({ id: 'inner_outer', label: 'stablehlo.reduce', namespace: 'parent/stablehlo.reduce_0' }),
        makeNode({ id: 'inner_body', label: 'stablehlo.add', namespace: 'parent/stablehlo.reduce_0' }),
    ];
    const index = buildGraphIndex('outer', nodes);
    assertIndexInvariants(index);

    // The outer-region op (`outer`) lives in `parent` and corresponds to the
    // inner region `parent/stablehlo.reduce_0`. The builder uses this to
    // decorate the outer node with a collapse-toggle hint.
    expect(index.outerNamespaceByNodeId.outer).toBe('parent/stablehlo.reduce_0');
});

// 3.2.13 — section namespaces do NOT credit `%argN` from a NESTED namespace
// as their inputs.  Regression test for the bug documented in the builder
// near the `inputsPrefix` check: previously, every `%argN` was credited to
// every ancestor in its chain (including synthetic sections), so
// cross-section edges silently rerouted to the phantom "section input" and
// the real edge to the inner op disappeared. After the fix, only direct
// `%argN` children of a namespace OR nodes under `<ns>/Inputs` count.
test('buildGraphIndex does not credit %argN from nested namespaces as inputs of ancestor sections', () => {
    const nodes = [
        ...aboveSectionThresholdWithRegion(),
        // Inject a `%arg0` deep inside the region. After sectioning prefixes
        // its namespace (e.g. `section_K_of_N/stablehlo.reduce_0`), it's no
        // longer a DIRECT child of any section — pre-fix this used to leak.
        makeNode({ id: 'rogue_arg', label: '%arg0', namespace: 'stablehlo.reduce_0' }),
    ];
    const index = buildGraphIndex('aboveThreshold', nodes);
    assertIndexInvariants(index);

    for (const sectionNs of index.sectionNamespaces) {
        const inputs = index.namespaceInputByNamespace[sectionNs] ?? [];
        expect(inputs.includes('rogue_arg'), `section "${sectionNs}" wrongly credited a nested %arg0`).toBe(false);
    }
});

// 3.2.14 — `containingNamespacesByNodeId` excludes non-collapsible namespaces.
test('buildGraphIndex lists only collapsible namespaces in containingNamespacesByNodeId', () => {
    // `solo_ns` has just one direct node so isn't collapsible by itself.
    const nodes = [
        makeNode({ id: 'a', label: 'op', namespace: 'solo_ns' }),
        makeNode({ id: 'b', label: 'op', namespace: 'multi_ns' }),
        makeNode({ id: 'c', label: 'op', namespace: 'multi_ns' }),
    ];
    const index = buildGraphIndex('containingFilter', nodes);
    assertIndexInvariants(index);

    expect(index.containingNamespacesByNodeId.a).toEqual([]);
    expect(index.containingNamespacesByNodeId.b).toEqual(['multi_ns']);
    expect(index.containingNamespacesByNodeId.c).toEqual(['multi_ns']);
});

// Bonus: confirm that buildGraphIndex is deterministic — same input twice
// yields structurally identical output. The phase-split refactor MUST
// preserve this; non-determinism would mean phases are accidentally
// observing each other's mid-mutation state.
test('buildGraphIndex is deterministic across runs on identical input', () => {
    const nodes = nestedRegions();
    const a = buildGraphIndex('det', nodes);
    const b = buildGraphIndex('det', nodes);

    expect(a.subgraphNamespaces).toEqual(b.subgraphNamespaces);
    expect(a.anchorByNamespace).toEqual(b.anchorByNamespace);
    expect(a.outerNamespaceByNodeId).toEqual(b.outerNamespaceByNodeId);
    expect(a.containingNamespacesByNodeId).toEqual(b.containingNamespacesByNodeId);
});

// Anchor pinned ops also work when carried by a node that doesn't match the
// natural label heuristic. Ensures the pinToGroupTop comparator wins both
// the matched-candidate AND fallback-direct-nodes branches.
test('buildGraphIndex respects pinToGroupTop on a node that does not match the region base label', () => {
    const nodes = [
        makeNode({ id: 'natural', label: 'unrelated', namespace: 'region_0' }),
        makeNode({ id: 'pinned', label: 'also-unrelated', namespace: 'region_0', pinToGroupTop: true }),
        makeNode({ id: 'extra', label: 'op', namespace: 'region_0', incomingEdges: [edge('natural')] }),
    ];
    const index = buildGraphIndex('pinFallback', nodes);
    assertIndexInvariants(index);

    expect(index.anchorByNamespace.region_0).toBe('pinned');
});
