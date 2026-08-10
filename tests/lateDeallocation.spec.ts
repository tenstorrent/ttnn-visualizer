// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    NO_CONSUMER_OPERATION_ID,
    getLastValidConsumer,
    getLateDeallocationCountSummary,
    getLateDeallocationRunStartSummary,
    selectLateDeallocationRunStarts,
} from '../src/functions/lateDeallocation';
import { TensorDeallocationReport } from '../src/model/BufferSummary';

const buildReport = (overrides: Partial<TensorDeallocationReport> = {}): TensorDeallocationReport => ({
    id: overrides.id ?? 1,
    address: overrides.address ?? 1024,
    lastOperationId: overrides.lastOperationId ?? 10,
    lastConsumerOperationId: overrides.lastConsumerOperationId ?? 5,
    consumerName: overrides.consumerName ?? 'ttnn.add',
});

const buildOperation = (id: number) => ({ id });

describe('getLastValidConsumer', () => {
    // Regression: the previous implementation used a bare `sort()`, which
    // compares stringified ids — "10" sorts before "2", so op 10 was never
    // seen as the last consumer and every row from 3 onward was reported as
    // holding a stale tensor.
    it('picks the numerically highest consumer, not the lexicographically last', () => {
        const operationNamesById = new Map([
            [2, 'ttnn.add'],
            [10, 'ttnn.multiply'],
        ]);

        expect(getLastValidConsumer([2, 10], operationNamesById)).toEqual({
            lastConsumerOperationId: 10,
            lastConsumerName: 'ttnn.multiply',
        });
    });

    it('walks back past deallocate consumers to the last real use', () => {
        const operationNamesById = new Map([
            [4, 'ttnn.add'],
            [9, 'ttnn::deallocate'],
            [12, 'ttnn.deallocate'],
        ]);

        expect(getLastValidConsumer([4, 9, 12], operationNamesById)).toEqual({
            lastConsumerOperationId: 4,
            lastConsumerName: 'ttnn.add',
        });
    });

    it('reports no consumer when every consumer is a deallocate', () => {
        const operationNamesById = new Map([[7, 'ttnn.deallocate']]);

        expect(getLastValidConsumer([7], operationNamesById)).toEqual({
            lastConsumerOperationId: NO_CONSUMER_OPERATION_ID,
            lastConsumerName: '',
        });
    });

    it('reports no consumer for an empty consumer list', () => {
        expect(getLastValidConsumer([], new Map())).toEqual({
            lastConsumerOperationId: NO_CONSUMER_OPERATION_ID,
            lastConsumerName: '',
        });
    });

    it('accepts operation id 0 as a real consumer', () => {
        const operationNamesById = new Map([[0, 'ttnn.from_torch']]);

        expect(getLastValidConsumer([0], operationNamesById)).toEqual({
            lastConsumerOperationId: 0,
            lastConsumerName: 'ttnn.from_torch',
        });
    });

    it('does not mutate the consumer array it is given', () => {
        const consumers = [10, 2, 7];
        getLastValidConsumer(consumers, new Map([[10, 'ttnn.add']]));

        expect(consumers).toEqual([10, 2, 7]);
    });
});

describe('selectLateDeallocationRunStarts', () => {
    it('finds nothing when there are no operations or no reports', () => {
        expect(selectLateDeallocationRunStarts({ operations: [], reportsByOpId: new Map() })).toEqual([]);
        expect(selectLateDeallocationRunStarts({ operations: [buildOperation(1)], reportsByOpId: new Map() })).toEqual(
            [],
        );
    });

    it('reports a single flagged row once, naming the tensor that goes stale', () => {
        const runStarts = selectLateDeallocationRunStarts({
            operations: [buildOperation(1)],
            reportsByOpId: new Map([[1, [buildReport({ id: 7 })]]]),
        });

        expect(runStarts).toHaveLength(1);
        expect(runStarts[0]).toMatchObject({ opId: 1, rowIndex: 0 });
        expect(runStarts[0].tensors.map((tensor) => tensor.id)).toEqual([7]);
    });

    it('reports only the first row of a long run', () => {
        const report = buildReport({ id: 3, address: 2048 });
        const runStarts = selectLateDeallocationRunStarts({
            operations: [buildOperation(1), buildOperation(2), buildOperation(3)],
            reportsByOpId: new Map([
                [1, [report]],
                [2, [report]],
                [3, [report]],
            ]),
        });

        expect(runStarts.map((runStart) => runStart.opId)).toEqual([1]);
    });

    it('opens a fresh run when the tensor drops out and comes back', () => {
        const report = buildReport({ id: 4, address: 4096 });
        const runStarts = selectLateDeallocationRunStarts({
            operations: [buildOperation(1), buildOperation(2), buildOperation(3)],
            reportsByOpId: new Map([
                [1, [report]],
                [3, [report]],
            ]),
        });

        expect(runStarts.map((runStart) => runStart.opId)).toEqual([1, 3]);
    });

    // An address outlives the tensor that used it, so two tensors sharing one
    // address must not be folded into a single continuous run — the second
    // tensor's run start is the row the user needs.
    it('treats two tensors reusing the same address as separate runs', () => {
        const runStarts = selectLateDeallocationRunStarts({
            operations: [buildOperation(1), buildOperation(2)],
            reportsByOpId: new Map([
                [1, [buildReport({ id: 1, address: 8192 })]],
                [2, [buildReport({ id: 2, address: 8192 })]],
            ]),
        });

        expect(runStarts.map((runStart) => runStart.opId)).toEqual([1, 2]);
    });

    it('reports only the newly stale tensor on a row where another run continues', () => {
        const held = buildReport({ id: 1, address: 1024 });
        const fresh = buildReport({ id: 2, address: 2048 });
        const runStarts = selectLateDeallocationRunStarts({
            operations: [buildOperation(1), buildOperation(2), buildOperation(3)],
            reportsByOpId: new Map([
                [1, [held]],
                [2, [held, fresh]],
                [3, [held, fresh]],
            ]),
        });

        expect(runStarts.map((runStart) => runStart.opId)).toEqual([1, 2]);
        expect(runStarts[1].tensors.map((tensor) => tensor.id)).toEqual([2]);
    });

    it('indexes rows by rendered position, not by operation id', () => {
        const runStarts = selectLateDeallocationRunStarts({
            operations: [buildOperation(40), buildOperation(41)],
            reportsByOpId: new Map([[41, [buildReport()]]]),
        });

        expect(runStarts[0]).toMatchObject({ opId: 41, rowIndex: 1 });
    });

    it('ignores reports for operations outside the rendered rows', () => {
        expect(
            selectLateDeallocationRunStarts({
                operations: [buildOperation(40)],
                reportsByOpId: new Map([[41, [buildReport()]]]),
            }),
        ).toEqual([]);
    });
});

describe('getLateDeallocationRunStartSummary', () => {
    it('names the tensor and its last consumer', () => {
        const summary = getLateDeallocationRunStartSummary({
            opId: 5,
            rowIndex: 4,
            tensors: [buildReport({ id: 7, lastConsumerOperationId: 3, consumerName: 'ttnn.add' })],
        });

        expect(summary).toContain('Opportunity to deallocate earlier');
        expect(summary).toContain('tensor 7');
        expect(summary).toContain('3 ttnn.add');
    });

    it('lists every tensor when several runs start on one row', () => {
        const summary = getLateDeallocationRunStartSummary({
            opId: 5,
            rowIndex: 4,
            tensors: [buildReport({ id: 7 }), buildReport({ id: 9 })],
        });

        expect(summary).toContain('tensors 7, 9');
    });

    it('omits the last-use clause when the consumer is unnamed', () => {
        const summary = getLateDeallocationRunStartSummary({
            opId: 5,
            rowIndex: 4,
            tensors: [buildReport({ id: 7, consumerName: '' })],
        });

        expect(summary).toBe('Opportunity to deallocate earlier: tensor 7');
    });
});

describe('getLateDeallocationCountSummary', () => {
    it('uses the singular verb for one operation', () => {
        expect(getLateDeallocationCountSummary(1)).toBe('1 operation holds a tensor that is no longer used');
    });

    it('uses the plural verb for several operations', () => {
        expect(getLateDeallocationCountSummary(4)).toBe('4 operations hold a tensor that is no longer used');
    });
});
