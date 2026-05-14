// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { expect } from 'vitest';
import type { BuiltGraph, GraphIndex } from '../../src/components/mlir/mlirGraphTypes';

/**
 * Cross-cutting invariants every `buildGraphIndex` result must uphold.
 * The phase-split refactor in `PR_ACTION_PLAN.md §5.1` is allowed to reorder
 * map insertions, rename helpers, and re-shuffle phases — but it MUST NOT
 * violate any of these.
 */
export function assertIndexInvariants(index: GraphIndex): void {
    const namespaceList = index.subgraphNamespaces;
    const namespaceSet = new Set(namespaceList);
    const nodeIdSet = new Set(index.nodes.map((n) => n.id));

    // (a) `subgraphNamespaces` has no duplicates (Phase 3 unions with synthetic
    // namespaces; a sloppy merge would dupe).
    expect(namespaceList.length).toBe(namespaceSet.size);

    // (b) Every namespace has an anchor, and that anchor is a real node id.
    for (const ns of namespaceList) {
        const anchor = index.anchorByNamespace[ns];
        expect(anchor, `namespace "${ns}" missing anchor`).toBeDefined();
        expect(nodeIdSet.has(anchor!), `anchor "${anchor}" for "${ns}" not in index.nodes`).toBe(true);
    }

    // (c) `anchorNamespaceByNodeId` is injective: no node anchors two namespaces.
    const anchorsSeen = new Set<string>();
    for (const [nodeId, ns] of Object.entries(index.anchorNamespaceByNodeId)) {
        expect(anchorsSeen.has(nodeId), `node "${nodeId}" anchors more than one namespace`).toBe(false);
        anchorsSeen.add(nodeId);
        expect(namespaceSet.has(ns), `node "${nodeId}" anchors unknown namespace "${ns}"`).toBe(true);
    }

    // (d) `containingNamespacesByNodeId[id]` is sorted shallow-to-deep and all
    // entries are real subgraph namespaces. (Builder relies on the ordering.)
    for (const [nodeId, chain] of Object.entries(index.containingNamespacesByNodeId)) {
        for (let i = 0; i < chain.length; i++) {
            expect(namespaceSet.has(chain[i]), `node "${nodeId}" lists unknown ns "${chain[i]}"`).toBe(true);
            if (i > 0) {
                // Each entry must extend the previous: deeper ns starts with `prev + '/'`.
                expect(chain[i].startsWith(`${chain[i - 1]}/`)).toBe(true);
            }
        }
    }

    // (e) `outerNamespaceByNodeId` values are real namespaces.
    for (const ns of Object.values(index.outerNamespaceByNodeId)) {
        expect(namespaceSet.has(ns), `outerNamespaceByNodeId value "${ns}" not a subgraph ns`).toBe(true);
    }

    // (f) Every entry in `namespaceInputByNamespace` / `namespaceReturnNodeByNamespace`
    // refers to a real node id and a real subgraph namespace.
    for (const [ns, inputIds] of Object.entries(index.namespaceInputByNamespace)) {
        expect(namespaceSet.has(ns)).toBe(true);
        for (const id of inputIds) {
            expect(nodeIdSet.has(id), `namespaceInputByNamespace[${ns}] node "${id}" missing`).toBe(true);
        }
    }
    for (const [ns, returnId] of Object.entries(index.namespaceReturnNodeByNamespace)) {
        expect(namespaceSet.has(ns)).toBe(true);
        expect(nodeIdSet.has(returnId), `namespaceReturnNodeByNamespace[${ns}] node "${returnId}" missing`).toBe(true);
    }

    // (g) Section namespaces are root-level (no '/'). Sections never nest.
    for (const sectionNs of index.sectionNamespaces) {
        expect(sectionNs.includes('/'), `section namespace "${sectionNs}" must be root-level`).toBe(false);
        expect(namespaceSet.has(sectionNs)).toBe(true);
    }
}

/**
 * Cross-cutting invariants every `buildVisibleGraph` result must uphold.
 * Each one corresponds to a previously-fixed silent-failure mode (edge
 * pointing at an unrendered node, missing parent reference, etc.) — these
 * are exactly the regressions a careless phase-split could re-introduce.
 */
export function assertBuiltGraphInvariants(built: BuiltGraph): void {
    const nodeIdSet = new Set(built.nodes.map((n) => n.id));

    // (a) Every edge endpoint must be a rendered node id. Edges to non-existent
    // nodes silently disappear in React Flow.
    for (const e of built.edges) {
        expect(nodeIdSet.has(e.source), `edge "${e.id}" source "${e.source}" not in built.nodes`).toBe(true);
        expect(nodeIdSet.has(e.target), `edge "${e.id}" target "${e.target}" not in built.nodes`).toBe(true);
    }

    // (b) Every node with `parentId` references a real parent (RF requires).
    for (const n of built.nodes) {
        if (n.parentId !== undefined) {
            expect(nodeIdSet.has(n.parentId), `node "${n.id}" parent "${n.parentId}" missing`).toBe(true);
        }
    }

    // (c) No duplicate node ids.
    expect(new Set(built.nodes.map((n) => n.id)).size).toBe(built.nodes.length);

    // (d) No duplicate edge ids.
    expect(new Set(built.edges.map((e) => e.id)).size).toBe(built.edges.length);

    // (e) Every edge has the canonical arrow marker shape.
    for (const e of built.edges) {
        if (e.markerEnd) {
            expect(e.markerEnd.type).toBe('arrowclosed');
            expect(e.markerEnd.height).toBe(20);
            expect(e.markerEnd.width).toBe(20);
        }
    }
}
