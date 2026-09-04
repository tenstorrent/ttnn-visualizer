// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { detectWeightFans } from '../src/components/operation-graph/opGraphWeightFans';
import type { CandidateEdge } from '../src/components/operation-graph/opGraphBuilder';
import type { OpGraphSourceOperation } from '../src/components/operation-graph/opGraphTypes';

const operation = (id: number, name: string): OpGraphSourceOperation =>
    ({ id, name, fileIdentifier: 'model.py:1', outputs: [], deviceOperationCount: 0 }) as OpGraphSourceOperation;

const edge = (source: number, target: number): CandidateEdge => ({
    source,
    target,
    label: '[1, 32]',
    tensorId: source * 10,
});

interface FanCase {
    operations: OpGraphSourceOperation[];
    edges: CandidateEdge[];
    /** Operations a grouping block owns. */
    claimed?: number[];
    /** Operations that render as something other than themselves. */
    renderedAs?: Record<number, string>;
}

const fansOf = ({ operations, edges, claimed = [], renderedAs = {} }: FanCase) =>
    detectWeightFans({
        keptOperations: operations,
        candidates: edges,
        kept: new Set(operations.map((candidate) => candidate.id)),
        renderedNodeIdOf: (operationId) => renderedAs[operationId] ?? String(operationId),
        isClaimed: (operationId) => claimed.includes(operationId),
    });

describe('detectWeightFans', () => {
    it('collapses sources that all feed one node', () => {
        const fans = fansOf({
            operations: [
                operation(1, 'ttnn.to_device'),
                operation(2, 'ttnn.to_device'),
                operation(3, 'ttnn.to_device'),
                operation(4, 'ttnn.linear'),
            ],
            edges: [edge(1, 4), edge(2, 4), edge(3, 4)],
        });

        expect(fans).toHaveLength(1);
        expect(fans[0].operationIds).toEqual([1, 2, 3]);
        expect(fans[0].label).toBe('3 weight loads');
        expect(fans[0].instanceId).toBe('weights:4');
    });

    it('matches on topology, not on the op name', () => {
        // `sentence_bert` loads weights with `to_device` and `bge_m3` with `from_torch`,
        // so a name list would already have missed one of the two reports we have. Named
        // here as something neither report uses, to pin that the rule reads structure.
        const fans = fansOf({
            operations: [
                operation(1, 'ttnn.some_future_loader'),
                operation(2, 'ttnn.some_future_loader'),
                operation(3, 'ttnn.matmul'),
            ],
            edges: [edge(1, 3), edge(2, 3)],
        });

        expect(fans).toHaveLength(1);
        expect(fans[0].operationIds).toEqual([1, 2]);
    });

    it('refuses a source whose consumers differ', () => {
        // The safety condition. A parameter feeding two nodes belongs to neither, and
        // folding it into one would have the graph assert it is that layer's. #1980
        const fans = fansOf({
            operations: [
                operation(1, 'ttnn.to_device'),
                operation(2, 'ttnn.to_device'),
                operation(3, 'ttnn.linear'),
                operation(4, 'ttnn.linear'),
            ],
            edges: [edge(1, 3), edge(2, 3), edge(2, 4)],
        });

        // Operation 2 is shared, so only one member is left and that is not a fan.
        expect(fans).toHaveLength(0);
    });

    it('groups by the rendered node, so a folded block gathers its members fans', () => {
        // Two consumers inside one folded block: their loads become a single fan,
        // because "the same rendered node" is what the rule is about.
        const fans = fansOf({
            operations: [
                operation(1, 'ttnn.to_device'),
                operation(2, 'ttnn.to_device'),
                operation(3, 'ttnn.linear'),
                operation(4, 'ttnn.linear'),
            ],
            edges: [edge(1, 3), edge(2, 4)],
            renderedAs: { 3: 'layer:attention:3', 4: 'layer:attention:3' },
        });

        expect(fans).toHaveLength(1);
        expect(fans[0].operationIds).toEqual([1, 2]);
        expect(fans[0].instanceId).toBe('weights:layer:attention:3');
    });

    it('never claims an operation a grouping block already owns', () => {
        const fans = fansOf({
            operations: [operation(1, 'ttnn.to_device'), operation(2, 'ttnn.to_device'), operation(3, 'ttnn.linear')],
            edges: [edge(1, 3), edge(2, 3)],
            claimed: [1, 2],
        });

        expect(fans).toHaveLength(0);
    });

    it('leaves a lone source alone', () => {
        // One member is not a fan: it replaces a node with a node and costs the reader
        // the tensor label the member's own edge was carrying.
        const fans = fansOf({
            operations: [operation(1, 'ttnn.to_device'), operation(2, 'ttnn.linear')],
            edges: [edge(1, 2)],
        });

        expect(fans).toHaveLength(0);
    });

    it('does not treat an operation with inputs as a source', () => {
        // A `linear` fed by a weight is not itself a weight, however few consumers it has.
        const fans = fansOf({
            operations: [
                operation(1, 'ttnn.to_device'),
                operation(2, 'ttnn.linear'),
                operation(3, 'ttnn.linear'),
                operation(4, 'ttnn.add'),
            ],
            edges: [edge(1, 2), edge(2, 4), edge(3, 4)],
        });

        // Only 1 and 3 are sources, and they feed different nodes, so nothing collapses.
        expect(fans).toHaveLength(0);
    });

    it('ignores an edge to an operation the filter removed', () => {
        // `kept` excludes it, so it must not count as a second consumer and disqualify
        // an otherwise sound fan.
        const fans = detectWeightFans({
            keptOperations: [
                operation(1, 'ttnn.to_device'),
                operation(2, 'ttnn.to_device'),
                operation(3, 'ttnn.linear'),
            ],
            candidates: [edge(1, 3), edge(2, 3), edge(2, 99)],
            kept: new Set([1, 2, 3]),
            renderedNodeIdOf: (operationId) => String(operationId),
            isClaimed: () => false,
        });

        expect(fans).toHaveLength(1);
        expect(fans[0].operationIds).toEqual([1, 2]);
    });
});
