// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    MAX_DETECT_OPS,
    MIN_REPEAT_COUNT,
    MIN_REPEAT_WINDOW,
    detectRepeatBlocks,
    formatRepeatPatternLabel,
    sumOptional,
} from '../src/components/operation-graph/opGraphRepeatBlocks';
import type { OpGraphSourceOperation } from '../src/components/operation-graph/opGraphTypes';

interface OperationSpec {
    id: number;
    name: string;
    consumers?: number[];
    inputShapes?: string[];
    edgeLabel?: string;
    fileIdentifier?: string;
}

const op = ({
    id,
    name,
    consumers = [],
    inputShapes,
    edgeLabel = '[1, 32]',
    fileIdentifier = `model.py:${id}`,
}: OperationSpec): OpGraphSourceOperation => ({
    id,
    name,
    fileIdentifier,
    outputs: [{ edgeLabel, consumers, tensorId: id * 100 }],
    deviceOperationCount: 0,
    inputShapes,
});

const chain = (
    specs: { id: number; name: string; inputShapes?: string[]; fileIdentifier?: string }[],
): OpGraphSourceOperation[] =>
    specs.map((spec, index) =>
        op({
            ...spec,
            consumers: index < specs.length - 1 ? [specs[index + 1].id] : [],
        }),
    );

const idsOf = (instances: ReturnType<typeof detectRepeatBlocks>) => instances.map((instance) => instance.operationIds);

describe('detectRepeatBlocks', () => {
    it('returns nothing when the graph is too short to hold two windows', () => {
        expect(
            detectRepeatBlocks(
                chain([
                    { id: 1, name: 'a' },
                    { id: 2, name: 'b' },
                    { id: 3, name: 'a' },
                ]),
            ),
        ).toEqual([]);
    });

    it('does not collapse a 1-op run of identical neighbours', () => {
        expect(
            detectRepeatBlocks(
                chain([
                    { id: 1, name: 'prefix' },
                    { id: 2, name: 'add' },
                    { id: 3, name: 'add' },
                    { id: 4, name: 'suffix' },
                ]),
            ),
        ).toEqual([]);
        expect(MIN_REPEAT_WINDOW).toBe(2);
        expect(MIN_REPEAT_COUNT).toBe(2);
    });

    it('collapses two contiguous copies of a 2-op window', () => {
        const instances = detectRepeatBlocks(
            chain([
                { id: 1, name: 'prefix' },
                { id: 2, name: 'layer_a' },
                { id: 3, name: 'layer_b' },
                { id: 4, name: 'layer_a' },
                { id: 5, name: 'layer_b' },
                { id: 6, name: 'suffix' },
            ]),
        );

        expect(idsOf(instances)).toEqual([
            [2, 3],
            [4, 5],
        ]);
        expect(instances[0].label).toBe('layer_a + layer_b × 2');
        expect(instances[0].patternLabel).toBe('layer_a + layer_b');
        expect(instances.map((instance) => instance.instanceIndex)).toEqual([0, 1]);
        expect(instances[0].instanceCount).toBe(2);
        expect(instances[0].patternId).toBe(instances[1].patternId);
        expect(instances[0].instanceId).toBe('block:0:2');
        expect(instances[1].instanceId).toBe('block:0:4');
    });

    it('does not collapse the same window when a different op sits between the copies', () => {
        expect(
            detectRepeatBlocks(
                chain([
                    { id: 1, name: 'layer_a' },
                    { id: 2, name: 'layer_b' },
                    { id: 3, name: 'other' },
                    { id: 4, name: 'layer_a' },
                    { id: 5, name: 'layer_b' },
                ]),
            ),
        ).toEqual([]);
    });

    it('takes the smallest window that repeats, extended maximally', () => {
        const instances = detectRepeatBlocks(
            chain([
                { id: 1, name: 'a' },
                { id: 2, name: 'b' },
                { id: 3, name: 'a' },
                { id: 4, name: 'b' },
                { id: 5, name: 'a' },
                { id: 6, name: 'b' },
                { id: 7, name: 'a' },
                { id: 8, name: 'b' },
                { id: 9, name: 'suffix' },
            ]),
        );

        expect(idsOf(instances)).toEqual([
            [1, 2],
            [3, 4],
            [5, 6],
            [7, 8],
        ]);
        expect(instances[0].label).toBe('a + b × 4');
    });

    it('reports per-layer copies rather than two half-model blocks', () => {
        const layer = (start: number): { id: number; name: string }[] => [
            { id: start, name: 'attn' },
            { id: start + 1, name: 'mlp' },
            { id: start + 2, name: 'norm' },
        ];
        const instances = detectRepeatBlocks(
            chain([
                ...layer(1),
                ...layer(4),
                ...layer(7),
                ...layer(10),
                ...layer(13),
                ...layer(16),
                { id: 19, name: 'suffix' },
            ]),
        );

        expect(instances).toHaveLength(6);
        expect(instances[0].label).toBe('attn + mlp + norm × 6');
        expect(instances[0].operationIds).toHaveLength(3);
    });

    it('does not join the last copy when its leaving tensors differ', () => {
        const instances = detectRepeatBlocks(
            chain([
                { id: 1, name: 'a' },
                { id: 2, name: 'b' },
                { id: 3, name: 'a' },
                { id: 4, name: 'b' },
                { id: 5, name: 'a' },
                { id: 6, name: 'b' },
            ]),
        );

        expect(idsOf(instances)).toEqual([
            [1, 2],
            [3, 4],
        ]);
        expect(instances[0].label).toBe('a + b × 2');
    });

    it("still matches when a dropped op sits on the first copy's outgoing edge", () => {
        const instances = detectRepeatBlocks([
            op({ id: 1, name: 'layer_a', consumers: [2] }),
            op({ id: 2, name: 'layer_b', consumers: [99] }),
            op({ id: 4, name: 'layer_a', consumers: [5] }),
            op({ id: 5, name: 'layer_b', consumers: [6] }),
            op({ id: 6, name: 'suffix' }),
        ]);

        expect(idsOf(instances)).toEqual([
            [1, 2],
            [4, 5],
        ]);
    });

    it('names a second pattern from its own ops', () => {
        const instances = detectRepeatBlocks(
            chain([
                { id: 1, name: 'a' },
                { id: 2, name: 'b' },
                { id: 3, name: 'a' },
                { id: 4, name: 'b' },
                { id: 5, name: 'c' },
                { id: 6, name: 'd' },
                { id: 7, name: 'c' },
                { id: 8, name: 'd' },
                { id: 9, name: 'suffix' },
            ]),
        );

        expect(instances.map((instance) => instance.patternLabel)).toEqual(['a + b', 'a + b', 'c + d', 'c + d']);
        expect(instances[2].label).toBe('c + d × 2');
        expect(instances[2].patternId).not.toBe(instances[0].patternId);
    });

    it('reuses the letter when the same pattern recurs after a gap', () => {
        const instances = detectRepeatBlocks(
            chain([
                { id: 1, name: 'a' },
                { id: 2, name: 'b' },
                { id: 3, name: 'a' },
                { id: 4, name: 'b' },
                { id: 5, name: 'other' },
                { id: 6, name: 'a' },
                { id: 7, name: 'b' },
                { id: 8, name: 'a' },
                { id: 9, name: 'b' },
                { id: 10, name: 'suffix' },
            ]),
        );

        expect(instances.map((instance) => instance.patternLabel)).toEqual(['a + b', 'a + b', 'a + b', 'a + b']);
    });

    it('does not treat matching fingerprints as a repeat when the internal edges differ', () => {
        const operations = [
            op({ id: 1, name: 'a', consumers: [2] }),
            op({ id: 2, name: 'b', consumers: [3] }),
            op({ id: 3, name: 'a', consumers: [5] }),
            op({ id: 4, name: 'b', consumers: [5] }),
            op({ id: 5, name: 'sink' }),
        ];

        expect(detectRepeatBlocks(operations)).toEqual([]);
    });

    it('does not match windows whose input shapes differ', () => {
        expect(
            detectRepeatBlocks(
                chain([
                    { id: 1, name: 'a', inputShapes: ['[1, 32]'] },
                    { id: 2, name: 'b' },
                    { id: 3, name: 'a', inputShapes: ['[1, 64]'] },
                    { id: 4, name: 'b' },
                    { id: 5, name: 'suffix' },
                ]),
            ),
        ).toEqual([]);
    });

    it('names a pattern from distinct member files and keeps that name across a gap', () => {
        const instances = detectRepeatBlocks(
            chain([
                { id: 1, name: 'q', fileIdentifier: 'attention.py:1' },
                { id: 2, name: 'ff', fileIdentifier: 'mlp.py:1' },
                { id: 3, name: 'q', fileIdentifier: 'attention.py:2' },
                { id: 4, name: 'ff', fileIdentifier: 'mlp.py:2' },
                { id: 5, name: 'other', fileIdentifier: 'other.py:1' },
                { id: 6, name: 'q', fileIdentifier: 'attention.py:3' },
                { id: 7, name: 'ff', fileIdentifier: 'mlp.py:3' },
                { id: 8, name: 'q', fileIdentifier: 'attention.py:4' },
                { id: 9, name: 'ff', fileIdentifier: 'mlp.py:4' },
                { id: 10, name: 'suffix', fileIdentifier: 'tail.py:1' },
            ]),
        );

        expect(instances.map((instance) => instance.patternLabel)).toEqual([
            'attention + mlp',
            'attention + mlp',
            'attention + mlp',
            'attention + mlp',
        ]);
        expect(instances[0].label).toBe('attention + mlp × 2');
    });

    it('returns nothing above MAX_DETECT_OPS rather than scanning', () => {
        const operations = Array.from({ length: MAX_DETECT_OPS + 1 }, (_, index) =>
            op({
                id: index + 1,
                name: index % 2 === 0 ? 'a' : 'b',
                consumers: index < MAX_DETECT_OPS ? [index + 2] : [],
            }),
        );

        expect(detectRepeatBlocks(operations)).toEqual([]);
    });
});

describe('formatRepeatPatternLabel', () => {
    it('joins unique file stems and drops lazy_weight when anything else remains', () => {
        expect(
            formatRepeatPatternLabel([
                op({ id: 1, name: 'ttnn.from_torch', fileIdentifier: 'lazy_weight.py:315' }),
                op({ id: 2, name: 'ttnn.layer_norm', fileIdentifier: 'norm.py:86' }),
                op({ id: 3, name: 'ttnn.linear', fileIdentifier: 'attention.py:193' }),
                op({ id: 4, name: 'ttnn.add', fileIdentifier: 'encoder.py:72' }),
                op({ id: 5, name: 'ttnn.gelu', fileIdentifier: 'mlp.py:112' }),
                op({ id: 6, name: 'ttnn.add', fileIdentifier: 'encoder.py:78' }),
            ]),
        ).toBe('norm + attention + encoder + mlp');
    });

    it('names a plumbing-only window from its ops', () => {
        expect(
            formatRepeatPatternLabel([
                op({ id: 1, name: 'ttnn.as_tensor', fileIdentifier: 'lazy_weight.py:10' }),
                op({ id: 2, name: 'ttnn.from_torch', fileIdentifier: 'lazy_weight.py:11' }),
            ]),
        ).toBe('as_tensor + from_torch');
    });

    it('names a single-operation-type block from the operation, not its file', () => {
        // Reported from the DeepSeek MoE graph: a block of two `ttnn.squeeze`
        // rendered as `tt_routed_expert`, which says where they live rather than
        // what the node is. The file only earns the label when it stands in for
        // several distinct operations.
        const members = [
            op({ id: 35, name: 'ttnn.squeeze', fileIdentifier: 'tt_routed_expert.py:165' }),
            op({ id: 36, name: 'ttnn.squeeze', fileIdentifier: 'tt_routed_expert.py:165' }),
        ];
        expect(
            formatRepeatPatternLabel(members, [
                ...members,
                op({ id: 10, name: 'ttnn.matmul', fileIdentifier: 'tt_moe.py:1' }),
            ]),
        ).toBe('squeeze');
    });

    it('still prefers the module when the block spans several operation types', () => {
        // The counterpart, and why the rule is narrow: four distinct operations
        // across four module files read better as the modules.
        const members = [
            op({ id: 1, name: 'ttnn.layer_norm', fileIdentifier: 'norm.py:86' }),
            op({ id: 2, name: 'ttnn.linear', fileIdentifier: 'attention.py:193' }),
            op({ id: 3, name: 'ttnn.add', fileIdentifier: 'encoder.py:72' }),
            op({ id: 4, name: 'ttnn.gelu', fileIdentifier: 'mlp.py:112' }),
        ];
        expect(formatRepeatPatternLabel(members)).toBe('norm + attention + encoder + mlp');
    });

    it('drops the framework-and-model prefix the module stems all share', () => {
        // Reported from the SentenceBERT graph: three module files whose names are
        // 60% one repeated prefix, clipped by the node it had to fit in.
        const members = [
            op({ id: 187, name: 'ttnn.layer_norm', fileIdentifier: 'ttnn_sentencebert_self_attention.py:31' }),
            op({ id: 188, name: 'ttnn.matmul', fileIdentifier: 'ttnn_sentencebert_self_output.py:44' }),
            op({ id: 189, name: 'ttnn.linear', fileIdentifier: 'ttnn_sentencebert_intermediate.py:19' }),
        ];
        expect(formatRepeatPatternLabel(members)).toBe('self_attention + self_output + intermediate');
    });

    it('leaves every stem a segment of its own when one is a prefix of the rest', () => {
        const members = [
            op({ id: 1, name: 'ttnn.linear', fileIdentifier: 'tt_llama_attention.py:1' }),
            op({ id: 2, name: 'ttnn.gelu', fileIdentifier: 'tt_llama_mlp.py:2' }),
            op({ id: 3, name: 'ttnn.add', fileIdentifier: 'tt_llama.py:3' }),
        ];
        // `tt` is shared but stripping it would leave `tt_llama` as the empty
        // string, so the prefix stays.
        expect(formatRepeatPatternLabel(members)).toBe('llama_attention + llama_mlp + llama');
    });

    it('keeps a shared prefix when stripping it would leave initials', () => {
        const members = [
            op({ id: 1, name: 'ttnn.linear', fileIdentifier: 'mlp_up.py:1' }),
            op({ id: 2, name: 'ttnn.gelu', fileIdentifier: 'mlp_down.py:2' }),
        ];
        expect(formatRepeatPatternLabel(members)).toBe('mlp_up + mlp_down');
    });

    it('leaves stems that share no leading segment alone', () => {
        const members = [
            op({ id: 1, name: 'ttnn.layer_norm', fileIdentifier: 'norm.py:86' }),
            op({ id: 2, name: 'ttnn.linear', fileIdentifier: 'attention.py:193' }),
        ];
        expect(formatRepeatPatternLabel(members)).toBe('norm + attention');
    });

    it('keeps a module file that is not most of the graph', () => {
        const members = [
            op({ id: 1, name: 'ttnn.as_tensor', fileIdentifier: 'tt_routed_expert.py:132' }),
            op({ id: 2, name: 'ttnn.squeeze', fileIdentifier: 'tt_routed_expert.py:163' }),
        ];
        expect(
            formatRepeatPatternLabel(members, [
                ...members,
                op({ id: 10, name: 'ttnn.matmul', fileIdentifier: 'tt_moe.py:1' }),
                op({ id: 11, name: 'ttnn.add', fileIdentifier: 'tt_moe_gate_prefill.py:1' }),
            ]),
        ).toBe('tt_routed_expert');
    });

    it('names from ops when the only file is the whole model', () => {
        const members = [
            op({ id: 1, name: 'ttnn.add_', fileIdentifier: 'ttnn_functional_resnet50.py:260' }),
            op({ id: 2, name: 'ttnn.conv2d', fileIdentifier: 'ttnn_functional_resnet50.py:196' }),
            op({ id: 3, name: 'ttnn.conv2d', fileIdentifier: 'ttnn_functional_resnet50.py:196' }),
            op({ id: 4, name: 'ttnn.conv2d', fileIdentifier: 'ttnn_functional_resnet50.py:196' }),
        ];
        const rest = Array.from({ length: 20 }, (_, index) =>
            op({
                id: 10 + index,
                name: 'ttnn.conv2d',
                fileIdentifier: 'ttnn_functional_resnet50.py:100',
            }),
        );
        expect(formatRepeatPatternLabel(members, [...members, ...rest])).toBe('add_ + conv2d');
    });

    it('falls back to short op names when no file identifier is present', () => {
        expect(
            formatRepeatPatternLabel([
                op({ id: 1, name: 'ttnn.matmul', fileIdentifier: '' }),
                op({ id: 2, name: 'ttnn.add', fileIdentifier: '' }),
            ]),
        ).toBe('matmul + add');
    });

    it('caps a long file list', () => {
        expect(
            formatRepeatPatternLabel([
                op({ id: 1, name: 'a', fileIdentifier: 'one.py:1' }),
                op({ id: 2, name: 'b', fileIdentifier: 'two.py:1' }),
                op({ id: 3, name: 'c', fileIdentifier: 'three.py:1' }),
                op({ id: 4, name: 'd', fileIdentifier: 'four.py:1' }),
                op({ id: 5, name: 'e', fileIdentifier: 'five.py:1' }),
            ]),
        ).toBe('one + two + three + four + …');
    });
});

describe('sumOptional', () => {
    it('adds finite numbers and skips the rest', () => {
        expect(sumOptional([1, undefined, 2.5, Number.NaN, Number.POSITIVE_INFINITY])).toBe(3.5);
        expect(sumOptional([])).toBe(0);
    });
});
