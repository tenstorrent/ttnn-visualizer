// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    detectWeightFans,
    weightFanIdCovers,
    weightFanMembersOf,
} from '../src/components/operation-graph/opGraphWeightFans';
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
        expect(fans[0].instanceId).toBe('weights:1-2-3');
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
        // because "the same rendered node" is what the rule is about. The *grouping* is
        // by rendered node; the *id* deliberately is not — see the next test.
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
        expect(fans[0].instanceId).toBe('weights:1-2');
    });

    it('keys the fan on its members, so its id does not move when its consumer folds', () => {
        // The consumer's rendered id is exactly what a grouping fold changes, so keying
        // on it meant a fan the user had unrolled re-folded itself the moment its layer
        // was folded — and left a dead id behind in a set nothing prunes. Reproduced
        // against the builder before this changed: the same fan was `weights:4` with the
        // layer unrolled and `weights:layer:attention:4` with it folded. #1980
        const operations = [
            operation(1, 'ttnn.to_device'),
            operation(2, 'ttnn.to_device'),
            operation(3, 'ttnn.linear'),
        ];
        const edges = [edge(1, 3), edge(2, 3)];

        const unrolled = fansOf({ operations, edges });
        const folded = fansOf({ operations, edges, renderedAs: { 3: 'layer:attention:3' } });

        expect(unrolled[0].instanceId).toBe('weights:1-2');
        expect(folded[0].instanceId).toBe(unrolled[0].instanceId);
    });

    it('renames itself when a fold merges it with another fan', () => {
        // Membership is fold-dependent: the members are grouped by the node they feed,
        // so folding two consumers into one block makes one fan out of two. Keyed on
        // the first member the survivor of [2,3] + [1] silently became `weights:1`,
        // which is a different fan wearing an id the reader had opened. The id is a
        // function of the membership now, so a merge reads as a merge. #1988
        const operations = [
            operation(1, 'ttnn.to_device'),
            operation(2, 'ttnn.to_device'),
            operation(3, 'ttnn.to_device'),
            operation(4, 'ttnn.linear'),
            operation(5, 'ttnn.linear'),
        ];
        const edges = [edge(1, 5), edge(2, 4), edge(3, 4)];

        const separate = fansOf({ operations, edges });
        const merged = fansOf({
            operations,
            edges,
            renderedAs: { 4: 'block:4', 5: 'block:4' },
        });

        expect(separate.map((fan) => fan.instanceId)).toEqual(['weights:2-3']);
        expect(merged.map((fan) => fan.instanceId)).toEqual(['weights:1-2-3']);
    });

    it("recovers a fan id's members, which is what survives a merge", () => {
        // The id spells out its membership so a remembered decision can be matched
        // against a fan that did not exist when it was made — no history kept.
        expect(weightFanMembersOf('weights:1-2-3')).toEqual([1, 2, 3]);
        expect(weightFanMembersOf('block:7')).toBeNull();
        expect(weightFanMembersOf('layer:attention:4')).toBeNull();

        // "Any", not "all". A remembered fan whose members only partly overlap is
        // still the reader having opened part of this one — membership shifts as
        // sources are claimed and released by grouping folds, so requiring every
        // remembered member to survive would drop the decision on the first shift.
        expect(weightFanIdCovers('weights:2-3', [1, 2, 3])).toBe(true);
        expect(weightFanIdCovers('weights:2-9', [1, 2, 3])).toBe(true);
        expect(weightFanIdCovers('weights:8-9', [1, 2, 3])).toBe(false);
        expect(weightFanIdCovers('block:2', [1, 2, 3])).toBe(false);
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
