// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    LastValidConsumer,
    MAX_NAMED_TENSORS,
    NO_CONSUMER_OPERATION_ID,
    buildLateDeallocationReports,
    coalesceLateDeallocationRunStarts,
    getLastValidConsumer,
    getLateDeallocationCountSummary,
    getLateDeallocationReport,
    getLateDeallocationSummary,
    selectLateDeallocationRunStarts,
} from '../src/functions/lateDeallocation';
import { Tensor } from '../src/model/APIData';
import { buildTensorDeallocationReport as buildReport } from './helpers/lateDeallocationFixtures';

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

    // Order-independence is the property that replaced the sort, and it is the
    // one a single-pass "highest so far" loop is easiest to lose: skipping a
    // deallocate must not stop the walk, or the ids after it are never seen.
    it('finds the last real use when the consumers arrive highest-first', () => {
        const operationNamesById = new Map([
            [4, 'ttnn.add'],
            [9, 'ttnn::deallocate'],
            [12, 'ttnn.deallocate'],
        ]);

        expect(getLastValidConsumer([12, 9, 4], operationNamesById)).toEqual({
            lastConsumerOperationId: 4,
            lastConsumerName: 'ttnn.add',
        });
    });
});

describe('buildLateDeallocationReports', () => {
    // Only `id` and `consumers` take part in the derivation; the rest of `Tensor`
    // would be fixture noise.
    const buildTensor = (id: number, consumers: number[]) => ({ id, consumers }) as unknown as Tensor;

    const operationNamesById = new Map([
        [1, 'ttnn.from_torch'],
        [2, 'ttnn.add'],
        [5, 'ttnn.multiply'],
        [8, 'ttnn.deallocate'],
    ]);

    // Tensor 7 is last used by op 2 and still alive at 5 and 8; tensor 9 is
    // still in use, so only the first should be reported.
    const tensorsByOperation = new Map([
        [2, new Map([[1024, buildTensor(7, [2])]])],
        [5, new Map([[1024, buildTensor(7, [2])]])],
        [
            8,
            new Map([
                [1024, buildTensor(7, [2])],
                [2048, buildTensor(9, [8])],
            ]),
        ],
    ]);

    it('indexes the reports by operation, skipping operations with nothing stale', () => {
        const { reportsByOpId } = buildLateDeallocationReports({ tensorsByOperation, operationNamesById });

        expect([...reportsByOpId.keys()]).toEqual([5, 8]);
        expect(reportsByOpId.get(5)?.map((report) => report.id)).toEqual([7]);
        expect(reportsByOpId.get(8)?.map((report) => report.id)).toEqual([7]);
    });

    // The Tensor List's filter and count read this index, so one entry per
    // tensor — not per (tensor, operation) — is the contract.
    it('indexes one report per tensor, the last operation holding it winning', () => {
        const { reportsByTensorId } = buildLateDeallocationReports({ tensorsByOperation, operationNamesById });

        expect([...reportsByTensorId.keys()]).toEqual([7]);
        expect(reportsByTensorId.get(7)).toMatchObject({ lastOperationId: 8, lastConsumerOperationId: 2 });
    });

    it('reports nothing for a report with no late deallocations', () => {
        const { reportsByOpId, reportsByTensorId } = buildLateDeallocationReports({
            tensorsByOperation: new Map([[2, new Map([[1024, buildTensor(7, [2])]])]]),
            operationNamesById,
        });

        expect(reportsByOpId.size).toBe(0);
        expect(reportsByTensorId.size).toBe(0);
    });
});

describe('getLateDeallocationReport', () => {
    const operationNamesById = new Map([
        [3, 'ttnn.add'],
        [8, 'ttnn.deallocate'],
    ]);

    it('reports a tensor still allocated after its last real use', () => {
        expect(
            getLateDeallocationReport(
                { tensorId: 7, address: 2048, operationId: 6, consumers: [3] },
                operationNamesById,
            ),
        ).toEqual({
            id: 7,
            address: 2048,
            lastOperationId: 6,
            lastConsumerOperationId: 3,
            consumerName: 'ttnn.add',
        });
    });

    // Regression: a tensor consumed only by deallocates has no last *use* to be
    // late relative to. Without the sentinel guard it was reported as
    // late-deallocated with its last consumer rendered as `-1`.
    it('reports nothing for a tensor whose only consumers are deallocates', () => {
        expect(
            getLateDeallocationReport(
                { tensorId: 7, address: 2048, operationId: 20, consumers: [8] },
                operationNamesById,
            ),
        ).toBeNull();
    });

    it('reports nothing while the tensor is still in use', () => {
        expect(
            getLateDeallocationReport(
                { tensorId: 7, address: 2048, operationId: 3, consumers: [3] },
                operationNamesById,
            ),
        ).toBeNull();
        expect(
            getLateDeallocationReport(
                { tensorId: 7, address: 2048, operationId: 2, consumers: [3] },
                operationNamesById,
            ),
        ).toBeNull();
    });

    it('reports nothing for a tensor with no id or no consumers', () => {
        expect(
            getLateDeallocationReport(
                { tensorId: null, address: 2048, operationId: 6, consumers: [3] },
                operationNamesById,
            ),
        ).toBeNull();
        expect(
            getLateDeallocationReport(
                { tensorId: 7, address: 2048, operationId: 6, consumers: [] },
                operationNamesById,
            ),
        ).toBeNull();
        expect(
            getLateDeallocationReport(
                { tensorId: 7, address: 2048, operationId: 6, consumers: null },
                operationNamesById,
            ),
        ).toBeNull();
    });

    it('names an unknown consumer operation with an empty string rather than dropping the report', () => {
        expect(
            getLateDeallocationReport({ tensorId: 7, address: 2048, operationId: 6, consumers: [4] }, new Map()),
        ).toMatchObject({ lastConsumerOperationId: 4, consumerName: '' });
    });

    it('resolves each tensor once, reusing the cache across the operations it spans', () => {
        const lastConsumerByTensorId = new Map<number, LastValidConsumer>();
        const candidate = { tensorId: 7, address: 2048, operationId: 6, consumers: [3] };

        getLateDeallocationReport(candidate, operationNamesById, lastConsumerByTensorId);

        expect(lastConsumerByTensorId.get(7)).toEqual({ lastConsumerOperationId: 3, lastConsumerName: 'ttnn.add' });

        // A seeded entry proves the cache is consulted rather than recomputed:
        // the same consumers now resolve to the cached answer.
        lastConsumerByTensorId.set(7, { lastConsumerOperationId: 2, lastConsumerName: 'ttnn.cached' });

        expect(getLateDeallocationReport(candidate, operationNamesById, lastConsumerByTensorId)).toMatchObject({
            lastConsumerOperationId: 2,
            consumerName: 'ttnn.cached',
        });
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

describe('getLateDeallocationSummary', () => {
    it('names the tensor and its last consumer', () => {
        const summary = getLateDeallocationSummary([
            buildReport({ id: 7, lastConsumerOperationId: 3, consumerName: 'ttnn.add' }),
        ]);

        expect(summary).toContain('Opportunity to deallocate earlier');
        expect(summary).toContain('tensor 7');
        expect(summary).toContain('3 ttnn.add');
    });

    it('names the shared last consumer once when the tensors agree on it', () => {
        const summary = getLateDeallocationSummary([buildReport({ id: 7 }), buildReport({ id: 9 })]);

        expect(summary).toBe('Opportunity to deallocate earlier: tensors 7, 9 — last used by 5 ttnn.add');
    });

    // Rows are the unique-buffer slice and a run can re-open after a gap, so
    // tensors reported on one row needn't share a last use. Naming the first
    // one's consumer for all of them attributed the wrong operation.
    it('names each tensor separately when their last consumers differ', () => {
        const summary = getLateDeallocationSummary([
            buildReport({ id: 7, lastConsumerOperationId: 3, consumerName: 'ttnn.add' }),
            buildReport({ id: 9, lastConsumerOperationId: 11, consumerName: 'ttnn.multiply' }),
        ]);

        expect(summary).toBe(
            'Opportunity to deallocate earlier: tensors 7 (last used by 3 ttnn.add), 9 (last used by 11 ttnn.multiply)',
        );
    });

    // The name comes from the operations list, which can still be loading, but
    // the id is always resolved and is the half the user acts on. Dropping the
    // whole clause left the marker saying nothing about the last use.
    it('names the last consumer by id alone when its name is unknown', () => {
        const summary = getLateDeallocationSummary([buildReport({ id: 7, consumerName: '' })]);

        expect(summary).toBe('Opportunity to deallocate earlier: tensor 7 — last used by 5');
    });

    it('names each unnamed consumer by id when the tensors disagree on their last use', () => {
        const summary = getLateDeallocationSummary([
            buildReport({ id: 7, lastConsumerOperationId: 3, consumerName: '' }),
            buildReport({ id: 9, lastConsumerOperationId: 11, consumerName: 'ttnn.multiply' }),
        ]);

        expect(summary).toBe(
            'Opportunity to deallocate earlier: tensors 7 (last used by 3), 9 (last used by 11 ttnn.multiply)',
        );
    });

    // A coalesced rail dot can stand for every run start in its bucket, so the
    // tensor list has to stop somewhere: an uncapped one grows with the report
    // and is retained for as long as the rail is mounted, since the same string
    // is the dot's accessible name.
    it('names only the first few tensors and counts the rest', () => {
        const tensors = Array.from({ length: MAX_NAMED_TENSORS + 3 }, (_unused, index) =>
            buildReport({ id: index + 1 }),
        );

        const summary = getLateDeallocationSummary(tensors);

        expect(summary).toBe(
            'Opportunity to deallocate earlier: tensors 1, 2, 3, 4, 5 and 3 more — last used by 5 ttnn.add',
        );
    });

    it('names them all when they fit under the cap', () => {
        const tensors = Array.from({ length: MAX_NAMED_TENSORS }, (_unused, index) => buildReport({ id: index + 1 }));

        expect(getLateDeallocationSummary(tensors)).toContain('tensors 1, 2, 3, 4, 5 —');
    });

    it('caps the per-tensor naming too, where each one carries its own last use', () => {
        const tensors = Array.from({ length: MAX_NAMED_TENSORS + 1 }, (_unused, index) =>
            buildReport({ id: index + 1, lastConsumerOperationId: index + 1 }),
        );

        const summary = getLateDeallocationSummary(tensors);

        expect(summary).toContain('1 (last used by 1 ttnn.add)');
        expect(summary).toContain('and 1 more');
        expect(summary).not.toContain('6 (last used by 6 ttnn.add)');
    });
});

describe('getLateDeallocationCountSummary', () => {
    // The count counts rows where a tensor *becomes* stale, while the overlay
    // hatches every row that keeps holding it — copy about operations
    // "holding" a tensor read as a contradiction beside dozens of hatched rows.
    it('uses the singular noun for one operation', () => {
        expect(getLateDeallocationCountSummary(1)).toBe(
            '1 operation where a tensor starts being held past its last use',
        );
    });

    it('uses the plural noun for several operations', () => {
        expect(getLateDeallocationCountSummary(4)).toBe(
            '4 operations where a tensor starts being held past its last use',
        );
    });
});

describe('coalesceLateDeallocationRunStarts', () => {
    const buildRunStart = (opId: number, rowIndex: number, tensorId: number) => ({
        opId,
        rowIndex,
        tensors: [buildReport({ id: tensorId })],
    });

    it('leaves run starts alone when every row has a dot of its own', () => {
        const runStarts = [buildRunStart(1, 0, 1), buildRunStart(3, 2, 2)];

        expect(
            coalesceLateDeallocationRunStarts({ runStarts, rowCount: 4, maxDots: 300 }).map(
                (runStart) => runStart.opId,
            ),
        ).toEqual([1, 3]);
    });

    it('merges run starts that would share a sliver of the rail, keeping every tensor', () => {
        // Two buckets at `maxDots: 2`: rows 0–49 and rows 50–99. The first three
        // run starts land in the first, the last one in the second.
        const runStarts = [buildRunStart(1, 0, 1), buildRunStart(2, 1, 2), buildRunStart(50, 49, 3)];

        const coalesced = coalesceLateDeallocationRunStarts({
            runStarts: [...runStarts, buildRunStart(51, 50, 4)],
            rowCount: 100,
            maxDots: 2,
        });

        expect(coalesced).toHaveLength(2);
        expect(coalesced[0]).toMatchObject({ opId: 1, rowIndex: 0 });
        expect(coalesced[0].tensors.map((tensor) => tensor.id)).toEqual([1, 2, 3]);
        // The second bucket keeps its own findings rather than being folded in.
        expect(coalesced[1]).toMatchObject({ opId: 51, rowIndex: 50 });
        expect(coalesced[1].tensors.map((tensor) => tensor.id)).toEqual([4]);
    });

    // The count beside the toggle counts run starts, so a merged dot dropping
    // one would leave the count advertising a finding no marker stands for.
    it('accounts for every tensor across the dots it keeps', () => {
        const runStarts = Array.from({ length: 40 }, (_unused, index) => buildRunStart(index + 1, index, index + 1));

        const coalesced = coalesceLateDeallocationRunStarts({ runStarts, rowCount: 40, maxDots: 4 });

        expect(coalesced).toHaveLength(4);
        expect(coalesced.flatMap((runStart) => runStart.tensors.map((tensor) => tensor.id))).toHaveLength(40);
    });

    it('does not mutate the run starts it was given', () => {
        const runStarts = [buildRunStart(1, 0, 1), buildRunStart(2, 1, 2)];

        coalesceLateDeallocationRunStarts({ runStarts, rowCount: 100, maxDots: 2 });

        expect(runStarts[0].tensors.map((tensor) => tensor.id)).toEqual([1]);
    });

    it('returns nothing when there are no rows to place dots against', () => {
        expect(
            coalesceLateDeallocationRunStarts({ runStarts: [buildRunStart(1, 0, 1)], rowCount: 0, maxDots: 300 }),
        ).toEqual([]);
    });
});
