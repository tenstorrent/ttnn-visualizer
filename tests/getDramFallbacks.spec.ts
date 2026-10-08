// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { getDramFallbackSummary, getDramFallbacks } from '../src/functions/getDramFallbacks';
import { DRAM_FALLBACK_RETRY_WINDOW_OPERATIONS, DramFallbackSignal } from '../src/definitions/DramFallback';
import { AllocationFailureKind } from '../src/definitions/AllocationFailure';
import { AllocationFailure } from '../src/model/AllocationFailure';
import { OperationDescription } from '../src/model/APIData';
import { BufferType, StringBufferType } from '../src/model/BufferType';
import { makeAllocationFailure } from './helpers/allocationFailure';
import { makeMemoryConfigArgument, makeOperation, makeTensor } from './helpers/operationDescription';

const INPUT_ADDRESS = 7023392;
const OUTPUT_ADDRESS = 1048576;

const dramInput = makeTensor({ id: 10, address: INPUT_ADDRESS, buffer_type: BufferType.DRAM });
const dramOutput = makeTensor({ id: 11, address: OUTPUT_ADDRESS, buffer_type: BufferType.DRAM });
const l1Output = makeTensor({ id: 12, address: OUTPUT_ADDRESS, buffer_type: BufferType.L1 });

/** An op that asked for L1 and got DRAM, unless overridden. */
const requestingL1 = (overrides: Partial<OperationDescription> = {}): OperationDescription =>
    makeOperation({
        arguments: [makeMemoryConfigArgument(StringBufferType.L1)],
        inputs: [dramInput],
        outputs: [dramOutput],
        ...overrides,
    });

const NO_FAILURES = new Map<number, AllocationFailure>();

describe('getDramFallbacks — argument vs output', () => {
    it('flags an L1 request whose output it allocated in DRAM', () => {
        const fallbacks = getDramFallbacks([requestingL1({ id: 5 })], NO_FAILURES);

        expect(fallbacks.get(5)).toEqual({
            signal: DramFallbackSignal.ARGUMENT_MISMATCH,
            operationId: 5,
            requestedBufferType: BufferType.L1,
            dramOutputCount: 1,
            outputCount: 1,
        });
    });

    // Every DRAM output that asked for L1 in the reports measured for #2081 was this: a
    // ttnn.reshape taking the view path, its output at its DRAM input's address.
    it('ignores an output that aliases an input, as a reshape view does', () => {
        const view = requestingL1({
            name: 'ttnn.reshape',
            outputs: [makeTensor({ id: 11, address: INPUT_ADDRESS, buffer_type: BufferType.DRAM })],
        });

        expect(getDramFallbacks([view], NO_FAILURES).size).toBe(0);
    });

    // L1 and each device's DRAM are separate address spaces: an equal number there is no view.
    it.each([
        ['an L1 input', makeTensor({ id: 10, address: INPUT_ADDRESS, buffer_type: BufferType.L1 })],
        ['a DRAM input on another device', makeTensor({ ...dramInput, device_id: 1 })],
    ])('flags a DRAM output at the same address as %s', (_, input) => {
        const operation = requestingL1({
            inputs: [input],
            outputs: [makeTensor({ id: 11, address: INPUT_ADDRESS, buffer_type: BufferType.DRAM })],
        });

        expect(getDramFallbacks([operation], NO_FAILURES).size).toBe(1);
    });

    it('flags a deallocated DRAM output, which has no address to alias', () => {
        const operation = requestingL1({ outputs: [makeTensor({ address: null, buffer_type: BufferType.DRAM })] });

        expect(getDramFallbacks([operation], NO_FAILURES).size).toBe(1);
    });

    it('counts L1_SMALL as an L1 request', () => {
        const operation = requestingL1({ arguments: [makeMemoryConfigArgument(StringBufferType.L1_SMALL)] });

        expect(getDramFallbacks([operation], NO_FAILURES).get(1)).toMatchObject({
            requestedBufferType: BufferType.L1_SMALL,
        });
    });

    // The case the intermediate exclusion exists for: without it, this request reads as mixed.
    it('flags an L1 output request beside a DRAM intermediate', () => {
        const operation = requestingL1({
            arguments: [
                makeMemoryConfigArgument(StringBufferType.L1),
                makeMemoryConfigArgument(StringBufferType.DRAM, 'intermediate_memory_config'),
            ],
        });

        expect(getDramFallbacks([operation], NO_FAILURES).get(1)).toMatchObject({
            signal: DramFallbackSignal.ARGUMENT_MISMATCH,
            requestedBufferType: BufferType.L1,
        });
    });

    it('reads a memory config passed positionally', () => {
        const operation = requestingL1({ arguments: [makeMemoryConfigArgument(StringBufferType.L1, '1')] });

        expect(getDramFallbacks([operation], NO_FAILURES).size).toBe(1);
    });

    it.each([
        ['an all-L1 output', { outputs: [l1Output] }],
        ['a DRAM request', { arguments: [makeMemoryConfigArgument(StringBufferType.DRAM)] }],
        [
            'a mixed L1 and DRAM request',
            {
                arguments: [
                    makeMemoryConfigArgument(StringBufferType.L1),
                    makeMemoryConfigArgument(StringBufferType.DRAM, 'memory_config_mm'),
                ],
            },
        ],
        ['no memory config argument', { arguments: [{ name: '1', value: '1, -1, 144', parsedValue: null }] }],
        [
            'an L1 intermediate and no output config',
            { arguments: [makeMemoryConfigArgument(StringBufferType.L1, 'intermediate_memory_config')] },
        ],
    ])('does not flag %s', (_, overrides) => {
        expect(getDramFallbacks([requestingL1(overrides)], NO_FAILURES).size).toBe(0);
    });

    it('counts only the DRAM outputs it allocated', () => {
        const operation = requestingL1({ outputs: [dramOutput, l1Output] });

        expect(getDramFallbacks([operation], NO_FAILURES).get(1)).toMatchObject({ dramOutputCount: 1, outputCount: 2 });
    });
});

describe('getDramFallbacks — retry after an L1 allocation failure', () => {
    const failed = makeOperation({ id: 10, name: 'ttnn.linear' });
    // The script asks for DRAM outright on its retry, so only the failure can tie the two together.
    const retry = (id: number) =>
        makeOperation({
            id,
            name: 'ttnn.linear',
            arguments: [makeMemoryConfigArgument(StringBufferType.DRAM)],
            outputs: [dramOutput],
        });
    const unrelated = (id: number) => makeOperation({ id, name: 'ttnn.add', outputs: [l1Output] });
    const failureByOpId = (failure: AllocationFailure = makeAllocationFailure({ operationId: 10 })) =>
        new Map([[10, failure]]);

    it('flags the same-named op that ran next with a DRAM output', () => {
        const fallbacks = getDramFallbacks([failed, unrelated(11), retry(12)], failureByOpId());

        expect(fallbacks.get(12)).toEqual({
            signal: DramFallbackSignal.RETRY_AFTER_FAILURE,
            operationId: 12,
            failedOperationId: 10,
            failedOperationName: 'ttnn.linear',
            dramOutputCount: 1,
            outputCount: 1,
        });
    });

    /** A retry `offset` operations after the failure, with unrelated ops between. */
    const retryAt = (offset: number) => [
        failed,
        ...Array.from({ length: offset - 1 }, (_, index) => unrelated(11 + index)),
        retry(10 + offset),
    ];

    it('reaches the last operation in the retry window', () => {
        const offset = DRAM_FALLBACK_RETRY_WINDOW_OPERATIONS;

        expect(getDramFallbacks(retryAt(offset), failureByOpId()).get(10 + offset)?.signal).toBe(
            DramFallbackSignal.RETRY_AFTER_FAILURE,
        );
    });

    it('does not reach past the retry window', () => {
        expect(getDramFallbacks(retryAt(DRAM_FALLBACK_RETRY_WINDOW_OPERATIONS + 1), failureByOpId()).size).toBe(0);
    });

    it('does not flag a retry after a DRAM allocation failure', () => {
        const dramFailure = makeAllocationFailure({ operationId: 10, bufferType: StringBufferType.DRAM });

        expect(getDramFallbacks([failed, retry(11)], failureByOpId(dramFailure)).size).toBe(0);
    });

    const circularBufferRange = { operationId: 10, operationName: 'ttnn.linear', coreRange: '[(x=0,y=0) - (x=7,y=7)]' };

    it.each<[string, AllocationFailure]>([
        ['an L1_SMALL bank failure', makeAllocationFailure({ operationId: 10, bufferType: StringBufferType.L1_SMALL })],
        [
            'an L1 bank failure after dependencies',
            makeAllocationFailure({
                operationId: 10,
                kind: AllocationFailureKind.BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES,
                allocatedBytes: 1300000,
                freeBytes: 82720,
                largestFreeBlockBytes: 65536,
            }),
        ],
        [
            'circular buffers outgrowing L1',
            {
                ...circularBufferRange,
                kind: AllocationFailureKind.CIRCULAR_BUFFERS_BEYOND_L1,
                circularBufferRegionEnd: 1600000,
                maxL1Bytes: 1499136,
            },
        ],
        [
            'circular buffers clashing with an L1 buffer',
            {
                ...circularBufferRange,
                kind: AllocationFailureKind.CIRCULAR_BUFFERS_CLASH,
                circularBufferRegionEnd: 1100000,
                l1BufferAddress: 1048576,
            },
        ],
    ])('flags a retry after %s', (_, failure) => {
        expect(getDramFallbacks([failed, retry(11)], failureByOpId(failure)).has(11)).toBe(true);
    });

    it('does not flag a retry that stayed in L1', () => {
        const stayedInL1 = makeOperation({ id: 11, name: 'ttnn.linear', outputs: [l1Output] });

        expect(getDramFallbacks([failed, stayedInL1], failureByOpId()).size).toBe(0);
    });

    // The first same-named op is the retry; once it stays in L1, a later DRAM call is a new one.
    it('looks only at the first same-named op in the window', () => {
        const stayedInL1 = makeOperation({ id: 11, name: 'ttnn.linear', outputs: [l1Output] });

        expect(getDramFallbacks([failed, stayedInL1, retry(12)], failureByOpId()).size).toBe(0);
    });

    it('does not flag a retry whose DRAM output is a view of its input', () => {
        const view = makeOperation({
            id: 11,
            name: 'ttnn.linear',
            inputs: [dramInput],
            outputs: [makeTensor({ id: 11, address: INPUT_ADDRESS, buffer_type: BufferType.DRAM })],
        });

        expect(getDramFallbacks([failed, view], failureByOpId()).size).toBe(0);
    });

    it('flags nothing when the failed op is the last one recorded', () => {
        expect(getDramFallbacks([unrelated(9), failed], failureByOpId()).size).toBe(0);
    });

    it('credits a retry to the nearest failure before it', () => {
        const earlierFailure = makeOperation({ id: 9, name: 'ttnn.linear' });
        const failureByOpIdForBoth = new Map([
            [9, makeAllocationFailure({ operationId: 9 })],
            [10, makeAllocationFailure({ operationId: 10 })],
        ]);

        expect(getDramFallbacks([earlierFailure, failed, retry(11)], failureByOpIdForBoth).get(11)).toMatchObject({
            failedOperationId: 10,
        });
    });

    it('outranks an argument mismatch on the same op', () => {
        const retryRequestingL1 = requestingL1({ id: 11, name: 'ttnn.linear' });

        expect(getDramFallbacks([failed, retryRequestingL1], failureByOpId()).get(11)?.signal).toBe(
            DramFallbackSignal.RETRY_AFTER_FAILURE,
        );
    });
});

describe('getDramFallbackSummary', () => {
    it('states the request against the outputs', () => {
        const [fallback] = getDramFallbacks([requestingL1({ outputs: [dramOutput, l1Output] })], NO_FAILURES).values();

        expect(getDramFallbackSummary(fallback)).toBe('Requested L1; 1 of 2 outputs in DRAM.');
    });

    it('names the operation that failed', () => {
        const fallbacks = getDramFallbacks(
            [
                makeOperation({ id: 412, name: 'ttnn.linear' }),
                makeOperation({ id: 413, name: 'ttnn.linear', outputs: [dramOutput] }),
            ],
            new Map([[412, makeAllocationFailure({ operationId: 412 })]]),
        );

        expect(getDramFallbackSummary(fallbacks.get(413)!)).toBe(
            'Retries operation 412 (ttnn.linear), which failed to allocate L1; 1 of 1 outputs in DRAM.',
        );
    });
});
