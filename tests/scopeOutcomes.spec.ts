// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { ScopeOutcome } from '../src/definitions/ScopeOutcome';
import { getFailedDeviceOperationNames, getScopeOutcomes } from '../src/functions/scopeOutcomes';
import { Node, NodeType } from '../src/model/APIData';

const start = (name: string, stackingLevel?: number): Node =>
    ({
        node_type: NodeType.function_start,
        params: { name },
        ...(stackingLevel !== undefined && { stacking_level: stackingLevel }),
    }) as unknown as Node;

const end = (name: string, params: { aborted?: string; abort_reason?: string } = {}, stackingLevel?: number): Node =>
    ({
        node_type: NodeType.function_end,
        params: { name, ...params },
        ...(stackingLevel !== undefined && { stacking_level: stackingLevel }),
    }) as unknown as Node;

const allocate = (): Node => ({ node_type: NodeType.buffer_allocate, params: {} }) as unknown as Node;

const { COMPLETED, FAILED, UNCLOSED } = ScopeOutcome;

describe('getScopeOutcomes', () => {
    it('closes nested scopes at their own ends', () => {
        const outcomes = getScopeOutcomes(
            [start('ttnn.conv2d'), start('Conv2d'), end('Conv2d'), end('ttnn.conv2d')],
            true,
        );

        expect(outcomes.closesByIndex).toEqual(
            new Map([
                [2, [{ startIndex: 1, outcome: COMPLETED, endIndex: 2, abortReason: null }]],
                [3, [{ startIndex: 0, outcome: COMPLETED, endIndex: 3, abortReason: null }]],
            ]),
        );
        expect(outcomes.closesAtEnd).toEqual([]);
    });

    it('fails a scope that ended aborted, with the reason tt-metal gave', () => {
        const outcomes = getScopeOutcomes(
            [start('Conv2d'), end('Conv2d', { aborted: 'true', abort_reason: 'Out of Memory' })],
            false,
        );

        expect(outcomes.closesByIndex.get(1)).toEqual([
            { startIndex: 0, outcome: FAILED, endIndex: 1, abortReason: 'Out of Memory' },
        ]);
    });

    it('fails a scope left open only when the operation recorded an error', () => {
        const nodes = [start('ttnn.conv2d'), start('Conv2d'), allocate()];

        expect(getScopeOutcomes(nodes, true).closesAtEnd).toEqual([
            { startIndex: 1, outcome: FAILED, endIndex: null, abortReason: null },
            { startIndex: 0, outcome: FAILED, endIndex: null, abortReason: null },
        ]);
        expect(getScopeOutcomes(nodes, false).closesAtEnd.map(({ outcome }) => outcome)).toEqual([UNCLOSED, UNCLOSED]);
    });

    it('lets an outer end close the scopes left open inside it first', () => {
        const outcomes = getScopeOutcomes([start('ttnn.conv2d'), start('Conv2d'), end('ttnn.conv2d')], true);

        expect(outcomes.closesByIndex.get(2)).toEqual([
            { startIndex: 1, outcome: FAILED, endIndex: null, abortReason: null },
            { startIndex: 0, outcome: COMPLETED, endIndex: 2, abortReason: null },
        ]);
    });

    it('closes nothing at an end whose scope is not open', () => {
        const outcomes = getScopeOutcomes(
            [end('ttnn.matmul', { aborted: 'true' }), start('Conv2d'), end('Halo'), end('Conv2d')],
            true,
        );

        expect([...outcomes.closesByIndex.keys()]).toEqual([3]);
        expect(outcomes.outcomeByStartIndex).toEqual(new Map([[1, COMPLETED]]));
    });

    it('closes a crossed inner scope with its outer one, and ignores its own end after', () => {
        const outcomes = getScopeOutcomes([start('A'), start('B'), end('A'), end('B')], true);

        expect(outcomes.closesByIndex.get(2)).toEqual([
            { startIndex: 1, outcome: FAILED, endIndex: null, abortReason: null },
            { startIndex: 0, outcome: COMPLETED, endIndex: 2, abortReason: null },
        ]);
        expect(outcomes.closesByIndex.has(3)).toBe(false);
    });

    it('closes a scope left open when a start at its own level follows, by stacking level', () => {
        const outcomes = getScopeOutcomes(
            [
                start('ttnn.conv2d', 1),
                start('Failed', 2),
                start('Next', 2),
                end('Next', {}, 2),
                end('ttnn.conv2d', {}, 1),
            ],
            true,
        );

        expect(outcomes.closesByIndex.get(2)).toEqual([
            { startIndex: 1, outcome: FAILED, endIndex: null, abortReason: null },
        ]);
        expect(outcomes.closesByIndex.get(3)).toEqual([
            { startIndex: 2, outcome: COMPLETED, endIndex: 3, abortReason: null },
        ]);
        expect(outcomes.closesByIndex.get(4)).toEqual([
            { startIndex: 0, outcome: COMPLETED, endIndex: 4, abortReason: null },
        ]);
    });

    it('closes every open scope at the same level or deeper when a shallower start follows', () => {
        const outcomes = getScopeOutcomes([start('ttnn.a', 1), start('Inner', 2), start('ttnn.b', 1)], false);

        expect(outcomes.closesByIndex.get(2)?.map(({ startIndex }) => startIndex)).toEqual([1, 0]);
        expect(outcomes.closesAtEnd.map(({ startIndex }) => startIndex)).toEqual([2]);
    });

    it('nests a start inside the open scope when the capture records no stacking level', () => {
        const outcomes = getScopeOutcomes([start('ttnn.conv2d'), start('Failed'), start('Next'), end('Next')], true);

        expect(outcomes.closesByIndex.has(2)).toBe(false);
        expect(outcomes.closesAtEnd.map(({ startIndex }) => startIndex)).toEqual([1, 0]);
    });
});

describe('getFailedDeviceOperationNames', () => {
    it('names the device operation whose launch did not complete, in either capture shape', () => {
        const aborted = [
            start('ttnn.conv2d'),
            start('Halo'),
            end('Halo'),
            start('Conv2d'),
            end('Conv2d', { aborted: 'true' }),
        ];
        const unclosed = [start('ttnn.conv2d'), start('Halo'), end('Halo'), start('Conv2d')];

        expect(getFailedDeviceOperationNames(aborted)).toEqual(['Conv2d']);
        expect(getFailedDeviceOperationNames(unclosed)).toEqual(['Conv2d']);
        expect(getFailedDeviceOperationNames([start('Halo'), end('Halo')])).toEqual([]);
    });

    it('names them in captured order, though inner scopes close first', () => {
        expect(getFailedDeviceOperationNames([start('Outer'), start('Inner')])).toEqual(['Outer', 'Inner']);
    });

    it('names the scope the device operations tree marks failed when ends cross', () => {
        expect(getFailedDeviceOperationNames([start('Outer'), start('Inner'), end('Outer'), end('Inner')])).toEqual([
            'Inner',
        ]);
    });

    it('returns nothing for a missing graph', () => {
        expect(getFailedDeviceOperationNames(undefined)).toEqual([]);
    });
});
