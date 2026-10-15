// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    getAllocationFailureDetail,
    getAllocationFailureDiagnosis,
    getAllocationFailureSummary,
    parseAllocationFailure,
} from '../src/functions/parseAllocationFailure';
import {
    ALLOCATION_FAILURE_REASON_LABELS,
    AllocationFailureKind,
    AllocationFailureReason,
} from '../src/definitions/AllocationFailure';
import { Node, NodeType, Operation } from '../src/model/APIData';
import { StringBufferType } from '../src/model/BufferType';
import { BankAllocationFailure } from '../src/model/AllocationFailure';
import { makeAllocationFailure } from './helpers/allocationFailure';

const BACKTRACE = 'backtrace:\n --- /workspace/build_Release/lib/libtt_metal.so(+0x570add) [0x7f0bc96eeadd]\n';

// As stored in a local report: the older allocator stops at the bank size.
const LEGACY_OUT_OF_MEMORY = `TT_FATAL @ /workspace/tt_metal/impl/allocator/bank_manager.cpp:433: address.has_value()
info:
Out of Memory: Not enough space to allocate 3276800 B L1 buffer across 4 banks, where each bank needs to store 819200 B, but bank size is only 1382720 B
${BACKTRACE}`;

// `bank_manager.cpp` at tt-metal e26c5edc51f.
const OUT_OF_MEMORY = `TT_FATAL @ /workspace/tt_metal/impl/allocator/bank_manager.cpp:486: false
info:
Out of Memory: Not enough space to allocate 3276800 B L1 buffer across 4 banks, where each bank needs to store 819200 B, but bank size is 1382720 B (allocated: 1000000 B, free: 382720 B, largest free block: 300000 B)
${BACKTRACE}`;

// A 3 KiB block holds the request, but a 1 KiB dependency range splits it into two windows.
const OUT_OF_MEMORY_WITH_DEPENDENCIES =
    'Out of Memory: Not enough space after considering dependencies to allocate 4096 B DRAM across 2 banks (2048 B per bank), bank size is 8192 B (allocated: 3072 B, free: 5120 B, largest free block: 3072 B). After subtracting 1 dependency range(s) and 0 additional occupied range(s), 2048 B remained placeable across 2 window(s), largest 1024 B';

// The allocator is itself fragmented: no block holds the request, so none is placeable.
const OUT_OF_MEMORY_WITH_DEPENDENCIES_FRAGMENTED =
    'Out of Memory: Not enough space after considering dependencies to allocate 1638400 B DRAM across 2 banks (819200 B per bank), bank size is 1382720 B (allocated: 382720 B, free: 1000000 B, largest free block: 300000 B). After subtracting 1 dependency range(s) and 0 additional occupied range(s), 0 B remained placeable across 0 window(s), largest 0 B';

// Before tt-metal 60e6701fa4e: no placeable figures after the allocator statistics.
const OUT_OF_MEMORY_WITH_DEPENDENCIES_WITHOUT_PLACEABLE = OUT_OF_MEMORY_WITH_DEPENDENCIES.replace(
    /\. After subtracting.*$/,
    '',
);

// As stored in a local report.
const CIRCULAR_BUFFERS_CLASH = `TT_THROW @ /workspace/tt_metal/impl/program/program.cpp:921: tt::exception
info:
Statically allocated circular buffers in program 166 clash with L1 buffers on core range [(x=0,y=0) - (x=4,y=7)]. L1 buffer allocated at 600256 and static circular buffer region ends at 621824
${BACKTRACE}`;

const CIRCULAR_BUFFERS_BEYOND_L1 =
    'Statically allocated circular buffers on core range [(x=0,y=0) - (x=7,y=7)] grow to 1600000 B which is beyond max L1 size of 1499136 B';

// The error as the API nests it under its operation, without the operation's id or name.
const operationError = (message: string, errorType = 'RuntimeError'): Pick<Operation, 'id' | 'name' | 'error'> => ({
    id: 240,
    name: 'ttnn.conv2d',
    error: {
        error_type: errorType,
        error_message: message,
        stack_trace: '',
        timestamp: '',
        rank: 0,
    },
});

describe('parseAllocationFailure', () => {
    it('reads an out-of-memory error from older tt-metal, which reports no free space', () => {
        expect(parseAllocationFailure(operationError(LEGACY_OUT_OF_MEMORY))).toMatchObject({
            operationId: 240,
            operationName: 'ttnn.conv2d',
            kind: AllocationFailureKind.BANK_OUT_OF_MEMORY,
            bufferType: StringBufferType.L1,
            requestedBytes: 3276800,
            numBanks: 4,
            bytesPerBank: 819200,
            bankSizeBytes: 1382720,
            freeBytes: null,
            largestFreeBlockBytes: null,
        });
    });

    it('reads the allocator statistics newer tt-metal appends', () => {
        expect(parseAllocationFailure(operationError(OUT_OF_MEMORY))).toMatchObject({
            kind: AllocationFailureKind.BANK_OUT_OF_MEMORY,
            allocatedBytes: 1000000,
            freeBytes: 382720,
            largestFreeBlockBytes: 300000,
        });
    });

    it('reads the dependency-aware out-of-memory error', () => {
        expect(parseAllocationFailure(operationError(OUT_OF_MEMORY_WITH_DEPENDENCIES))).toMatchObject({
            kind: AllocationFailureKind.BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES,
            bufferType: StringBufferType.DRAM,
            requestedBytes: 4096,
            numBanks: 2,
            bytesPerBank: 2048,
            freeBytes: 5120,
            largestFreeBlockBytes: 3072,
            placeableBytes: 2048,
            largestPlaceableBytes: 1024,
        });
    });

    it('reads the dependency-aware error from before it reported what was placeable', () => {
        expect(parseAllocationFailure(operationError(OUT_OF_MEMORY_WITH_DEPENDENCIES_WITHOUT_PLACEABLE))).toMatchObject(
            {
                kind: AllocationFailureKind.BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES,
                freeBytes: 5120,
                placeableBytes: null,
                largestPlaceableBytes: null,
            },
        );
    });

    it('leaves the placeable figures empty on the plain out-of-memory error', () => {
        expect(parseAllocationFailure(operationError(OUT_OF_MEMORY))).toMatchObject({
            kind: AllocationFailureKind.BANK_OUT_OF_MEMORY,
            placeableBytes: null,
            largestPlaceableBytes: null,
        });
    });

    it('reads a circular-buffer clash', () => {
        expect(parseAllocationFailure(operationError(CIRCULAR_BUFFERS_CLASH))).toMatchObject({
            kind: AllocationFailureKind.CIRCULAR_BUFFERS_CLASH,
            coreRange: '[(x=0,y=0) - (x=4,y=7)]',
            l1BufferAddress: 600256,
            circularBufferRegionEnd: 621824,
        });
    });

    it('reads circular buffers that grow beyond L1', () => {
        expect(parseAllocationFailure(operationError(CIRCULAR_BUFFERS_BEYOND_L1))).toMatchObject({
            kind: AllocationFailureKind.CIRCULAR_BUFFERS_BEYOND_L1,
            coreRange: '[(x=0,y=0) - (x=7,y=7)]',
            circularBufferRegionEnd: 1600000,
            maxL1Bytes: 1499136,
        });
    });

    it('ignores errors that are not allocation failures', () => {
        expect(parseAllocationFailure(operationError('Shape mismatch', 'TypeError'))).toBeNull();
        expect(
            parseAllocationFailure(
                operationError("Operation 'ttnn.conv2d' started but never completed", 'incomplete_operation'),
            ),
        ).toBeNull();
        expect(parseAllocationFailure({ id: 240, name: 'ttnn.conv2d', error: null })).toBeNull();
    });
});

describe('getAllocationFailureDetail', () => {
    const start = (name: string) => ({ node_type: NodeType.function_start, params: { name } }) as unknown as Node;

    it('gives the failure with the device operations whose launch it stopped', () => {
        expect(
            getAllocationFailureDetail({
                ...operationError(OUT_OF_MEMORY),
                device_operations: [start('ttnn.conv2d'), start('Conv2d')],
            }),
        ).toEqual({
            failure: parseAllocationFailure(operationError(OUT_OF_MEMORY)),
            failedDeviceOperations: ['Conv2d'],
        });
    });

    it('gives nothing for an error that is not an allocation failure', () => {
        expect(
            getAllocationFailureDetail({ ...operationError('Shape mismatch'), device_operations: [start('Conv2d')] }),
        ).toBeNull();
    });
});

describe('getAllocationFailureSummary', () => {
    it('states the free space only when the message reports it', () => {
        const legacy = parseAllocationFailure(operationError(LEGACY_OUT_OF_MEMORY))!;
        const current = parseAllocationFailure(operationError(OUT_OF_MEMORY))!;

        expect(getAllocationFailureSummary(legacy)).toBe(
            'Requested 3.13 MiB L1 across 4 banks (800 KiB per bank, bank size 1.32 MiB)',
        );
        expect(getAllocationFailureSummary(current)).toContain('; free 374 KiB, largest free block 293 KiB');
    });

    it("gives what remained placeable after the allocator's own free space", () => {
        const dependencies = parseAllocationFailure(operationError(OUT_OF_MEMORY_WITH_DEPENDENCIES))!;
        const older = parseAllocationFailure(operationError(OUT_OF_MEMORY_WITH_DEPENDENCIES_WITHOUT_PLACEABLE))!;

        expect(getAllocationFailureSummary(dependencies)).toBe(
            'Requested 4 KiB DRAM across 2 banks (2 KiB per bank, bank size 8 KiB); free 5 KiB, largest free block 3 KiB; placeable 2 KiB, largest placeable window 1 KiB',
        );
        expect(getAllocationFailureSummary(older)).toBe(
            'Requested 4 KiB DRAM across 2 banks (2 KiB per bank, bank size 8 KiB); free 5 KiB, largest free block 3 KiB',
        );
    });

    it('labels the buffer type for display', () => {
        const dependencies = parseAllocationFailure(
            operationError(OUT_OF_MEMORY_WITH_DEPENDENCIES.replace('B DRAM across', 'B L1_SMALL across')),
        )!;

        expect(getAllocationFailureSummary(dependencies)).toMatch(/^Requested 4 KiB L1 Small across 2 banks/);
    });

    it('gives the circular-buffer growth beyond L1 as sizes that compare', () => {
        const beyond = parseAllocationFailure(operationError(CIRCULAR_BUFFERS_BEYOND_L1))!;

        expect(getAllocationFailureSummary(beyond)).toBe(
            'Circular buffers on [(x=0,y=0) - (x=7,y=7)] grow to 1.53 MiB, beyond the L1 size of 1.43 MiB',
        );
    });

    it('gives the circular-buffer clash as addresses, in hex when asked', () => {
        const clash = parseAllocationFailure(operationError(CIRCULAR_BUFFERS_CLASH))!;

        expect(getAllocationFailureSummary(clash)).toBe(
            'Circular buffers on [(x=0,y=0) - (x=4,y=7)] end at 621824, past an L1 buffer at 600256',
        );
        expect(getAllocationFailureSummary(clash, true)).toBe(
            'Circular buffers on [(x=0,y=0) - (x=4,y=7)] end at 0x97D00, past an L1 buffer at 0x928C0',
        );
    });
});

describe('getAllocationFailureDiagnosis', () => {
    const { NOT_ENOUGH_FREE_SPACE, FRAGMENTED, FREE_BLOCK_COULD_HOLD_IT, LARGER_THAN_EMPTY_BANK } =
        AllocationFailureReason;

    const bank = (overrides: Partial<BankAllocationFailure>) =>
        makeAllocationFailure({ bufferType: StringBufferType.DRAM, ...overrides });

    const diagnose = (message: string) =>
        getAllocationFailureDiagnosis(parseAllocationFailure(operationError(message))!);

    // The reason, with the detail matching a pattern.
    const matching = (reason: AllocationFailureReason, detail: RegExp) => ({
        reason,
        detail: expect.stringMatching(detail),
    });

    it('calls a request that free space covers but no single block holds fragmentation', () => {
        expect(
            getAllocationFailureDiagnosis(
                bank({ freeBytes: 1000000, largestFreeBlockBytes: 300000, bytesPerBank: 819200 }),
            ),
        ).toEqual({
            reason: FRAGMENTED,
            detail: '977 KiB free per bank, but no single block holds 800 KiB; the largest is 293 KiB.',
        });
    });

    it('gives the shortfall when there is not enough free space', () => {
        expect(diagnose(OUT_OF_MEMORY)).toEqual({
            reason: NOT_ENOUGH_FREE_SPACE,
            detail: 'Short by 426 KiB per bank: needs 800 KiB, 374 KiB free. An interleaved L1 buffer can use only the part of that free space inside the interleaved region, so it may be short by more.',
        });
        expect(
            getAllocationFailureDiagnosis(bank({ freeBytes: 100, largestFreeBlockBytes: 100, bytesPerBank: 300 })),
        ).toEqual({ reason: NOT_ENOUGH_FREE_SPACE, detail: 'Short by 200 B per bank: needs 300 B, 100 B free.' });
    });

    it('calls free space exactly the request fragmentation, and a block exactly the request large enough', () => {
        expect(
            getAllocationFailureDiagnosis(bank({ freeBytes: 300, largestFreeBlockBytes: 299, bytesPerBank: 300 }))
                ?.reason,
        ).toBe(FRAGMENTED);
        expect(
            getAllocationFailureDiagnosis(bank({ freeBytes: 300, largestFreeBlockBytes: 300, bytesPerBank: 300 }))
                ?.reason,
        ).toBe(FREE_BLOCK_COULD_HOLD_IT);
    });

    it('caveats fragmentation on L1, where an interleaved buffer cannot use all of the free space', () => {
        expect(
            getAllocationFailureDiagnosis(makeAllocationFailure({ freeBytes: 1000000, largestFreeBlockBytes: 300000 })),
        ).toEqual(
            matching(
                FRAGMENTED,
                /An interleaved L1 buffer can use only the part of that free space inside the interleaved region\.$/,
            ),
        );
    });

    it('never calls it a shortfall when a free block is large enough', () => {
        const fits = { freeBytes: 1000000, largestFreeBlockBytes: 900000 };

        // tt-metal throws a different error when the block lies below the interleaved limit,
        // so the plain error gives no reason whatever the buffer type.
        expect(getAllocationFailureDiagnosis(makeAllocationFailure(fits))).toEqual({
            reason: FREE_BLOCK_COULD_HOLD_IT,
            detail: 'The largest free block, 879 KiB, could hold the 800 KiB per bank, but the allocator could not use it; the message does not say why.',
        });
        expect(getAllocationFailureDiagnosis(bank(fits))).toEqual(
            matching(FREE_BLOCK_COULD_HOLD_IT, /the message does not say why\.$/),
        );
        expect(
            getAllocationFailureDiagnosis(
                bank({ ...fits, kind: AllocationFailureKind.BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES }),
            ),
        ).toEqual(matching(FREE_BLOCK_COULD_HOLD_IT, /space reserved by other allocators overlaps it\.$/));
    });

    it("says other allocators' reservations split a block that would have held the request", () => {
        expect(diagnose(OUT_OF_MEMORY_WITH_DEPENDENCIES)).toEqual({
            reason: FREE_BLOCK_COULD_HOLD_IT,
            detail: "The largest free block, 3 KiB, could hold the 2 KiB per bank, but other allocators' reservations leave a placeable window of at most 1 KiB.",
        });
        expect(diagnose(OUT_OF_MEMORY_WITH_DEPENDENCIES.replace('B DRAM across', 'B L1 across'))).toEqual(
            matching(
                FREE_BLOCK_COULD_HOLD_IT,
                /at most 1 KiB\. An interleaved L1 buffer is also limited to the interleaved region\.$/,
            ),
        );
    });

    it("diagnoses the dependency-aware error from the allocator's own figures when it was itself fragmented", () => {
        expect(diagnose(OUT_OF_MEMORY_WITH_DEPENDENCIES_FRAGMENTED)).toEqual({
            reason: FRAGMENTED,
            detail: '977 KiB free per bank, but no single block holds 800 KiB; the largest is 293 KiB.',
        });
    });

    it('says nothing about an older error that gives no free space', () => {
        expect(diagnose(LEGACY_OUT_OF_MEMORY)).toBeNull();
    });

    it('says when the request is larger than an empty bank, whether or not free space is reported', () => {
        const expected = {
            reason: LARGER_THAN_EMPTY_BANK,
            detail: 'Needs 1.91 MiB per bank, more than an empty bank holds (1.32 MiB): it cannot fit in this buffer type spread across 4 banks.',
        };

        expect(getAllocationFailureDiagnosis(makeAllocationFailure({ bytesPerBank: 2000000 }))).toEqual(expected);
        expect(
            getAllocationFailureDiagnosis(
                bank({ bytesPerBank: 2000000, freeBytes: 382720, largestFreeBlockBytes: 300000 }),
            ),
        ).toEqual(expected);
    });

    it('does not call a request exactly the bank size larger than an empty bank', () => {
        expect(
            getAllocationFailureDiagnosis(
                bank({ bytesPerBank: 1382720, freeBytes: 382720, largestFreeBlockBytes: 300000 }),
            )?.reason,
        ).toBe(NOT_ENOUGH_FREE_SPACE);
    });

    it('gives how far circular buffers run past L1', () => {
        expect(diagnose(CIRCULAR_BUFFERS_BEYOND_L1)).toEqual({
            reason: AllocationFailureReason.BEYOND_END_OF_L1,
            detail: 'The circular buffers run 99 KiB past the end of L1.',
        });
    });

    it('gives the circular-buffer clash overlap, with the address in hex when asked', () => {
        const clash = parseAllocationFailure(operationError(CIRCULAR_BUFFERS_CLASH))!;

        expect(getAllocationFailureDiagnosis(clash)).toEqual({
            reason: AllocationFailureReason.OVERLAPS_L1_BUFFER,
            detail: 'The circular buffers overlap the L1 buffer at 600256 by 21 KiB.',
        });
        expect(getAllocationFailureDiagnosis(clash, true)?.detail).toBe(
            'The circular buffers overlap the L1 buffer at 0x928C0 by 21 KiB.',
        );
    });

    it('has a label for every reason', () => {
        Object.values(AllocationFailureReason).forEach((reason) => {
            expect(ALLOCATION_FAILURE_REASON_LABELS[reason]).toBeTruthy();
        });
    });
});
