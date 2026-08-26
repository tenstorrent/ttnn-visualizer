// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { detectRepeatBlocks, sumOptional } from '../src/components/operation-graph/opGraphRepeatBlocks';
import type { OpGraphSourceOperation } from '../src/components/operation-graph/opGraphTypes';

interface OperationSpec {
    id: number;
    name: string;
    consumers?: number[];
    inputShapes?: string[];
    edgeLabel?: string;
}

const op = ({
    id,
    name,
    consumers = [],
    inputShapes,
    edgeLabel = '[1, 32]',
}: OperationSpec): OpGraphSourceOperation => ({
    id,
    name,
    fileIdentifier: `model.py:${id}`,
    outputs: consumers.length === 0 ? [] : [{ edgeLabel, consumers, tensorId: id * 100 }],
    deviceOperationCount: 0,
    inputShapes,
});

const chain = (specs: { id: number; name: string; inputShapes?: string[] }[]): OpGraphSourceOperation[] =>
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

    it('does not collapse a 1-op run, including two identical neighbours', () => {
        expect(
            detectRepeatBlocks(
                chain([
                    { id: 1, name: 'a' },
                    { id: 2, name: 'a' },
                ]),
            ),
        ).toEqual([]);
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
        expect(instances[0].label).toBe('Block A × 2');
        expect(instances[0].patternLabel).toBe('Block A');
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

    it('prefers the longest matching window over more copies of a shorter one', () => {
        // Suffix so the last copy still emits the same outgoing tensor the fingerprint keys on.
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
            [1, 2, 3, 4],
            [5, 6, 7, 8],
        ]);
        expect(instances[0].label).toBe('Block A × 2');
    });

    it('still takes three copies when no longer window matches', () => {
        const instances = detectRepeatBlocks(
            chain([
                { id: 1, name: 'a' },
                { id: 2, name: 'b' },
                { id: 3, name: 'a' },
                { id: 4, name: 'b' },
                { id: 5, name: 'a' },
                { id: 6, name: 'b' },
                { id: 7, name: 'suffix' },
            ]),
        );

        expect(idsOf(instances)).toEqual([
            [1, 2],
            [3, 4],
            [5, 6],
        ]);
        expect(instances[0].label).toBe('Block A × 3');
        expect(instances[0].instanceCount).toBe(3);
    });

    it('assigns a new letter to a second pattern', () => {
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

        expect(instances.map((instance) => instance.patternLabel)).toEqual([
            'Block A',
            'Block A',
            'Block B',
            'Block B',
        ]);
        expect(instances[2].label).toBe('Block B × 2');
        expect(instances[2].patternId).not.toBe(instances[0].patternId);
    });

    it('does not treat matching fingerprints as a repeat when the internal edges differ', () => {
        // Same names and output labels, but only the first copy connects a → b.
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
                ]),
            ),
        ).toEqual([]);
    });
});

describe('sumOptional', () => {
    it('adds finite numbers and skips the rest', () => {
        expect(sumOptional([1, undefined, 2.5, Number.NaN, Number.POSITIVE_INFINITY])).toBe(3.5);
        expect(sumOptional([])).toBe(0);
    });
});
