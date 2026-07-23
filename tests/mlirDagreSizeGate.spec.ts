// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// FakeGraph is a minimal dagre stub: most methods are intentionally stateless
// sinks, so `this`-usage enforcement doesn't apply here.
/* eslint-disable class-methods-use-this */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAGRE_NODE_LIMIT, dagreLayout } from '../src/components/mlir/mlirGraphBuilder';
import type { WorkerNode } from '../src/components/mlir/mlirGraphTypes';

// Record the `ranker` handed to every dagre graph so the test can assert which
// layout strategy the size-gate selected. jsdom has no real dagre needs here —
// we only care about the option passed to setGraph, not the produced positions.
const rankers = vi.hoisted(() => [] as string[]);

vi.mock('@dagrejs/dagre', () => {
    class FakeGraph {
        private readonly sizes = new Map<string, { width: number; height: number }>();

        setGraph(options: { ranker?: string }): void {
            rankers.push(options.ranker ?? 'network-simplex');
        }

        setDefaultEdgeLabel(): void {}

        setNode(id: string, value: { width: number; height: number }): void {
            this.sizes.set(id, value);
        }

        setEdge(): void {}

        node(id: string): { x: number; y: number; width: number; height: number } {
            const size = this.sizes.get(id) ?? { width: 0, height: 0 };
            return { x: 0, y: 0, ...size };
        }
    }
    return { default: { graphlib: { Graph: FakeGraph }, layout: () => {} } };
});

const makeNodes = (count: number): WorkerNode[] =>
    Array.from({ length: count }, (_, i) => ({
        id: `n${i}`,
        position: { x: 0, y: 0 },
        data: { label: 'op', namespace: '', kind: 'op' as const },
    }));

describe('dagreLayout size-gate', () => {
    beforeEach(() => {
        rankers.length = 0;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('uses tight-tree in a single pass at or below the node limit', () => {
        dagreLayout(makeNodes(DAGRE_NODE_LIMIT), []);
        expect(rankers).toEqual(['tight-tree']);
    });

    it('uses a single default (network-simplex) pass above the node limit', () => {
        dagreLayout(makeNodes(DAGRE_NODE_LIMIT + 1), []);
        expect(rankers).toEqual(['network-simplex']);
    });

    it('never falls back to tight-tree above the node limit (regression guard)', () => {
        dagreLayout(makeNodes(DAGRE_NODE_LIMIT + 500), []);
        expect(rankers).not.toContain('tight-tree');
    });
});
