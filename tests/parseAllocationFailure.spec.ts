// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { getAllocationFailureSummary, parseAllocationFailure } from '../src/functions/parseAllocationFailure';
import { AllocationFailureKind } from '../src/definitions/AllocationFailure';
import { Operation } from '../src/model/APIData';
import { StringBufferType } from '../src/model/BufferType';

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

const OUT_OF_MEMORY_WITH_DEPENDENCIES =
    'Out of Memory: Not enough space after considering dependencies to allocate 2048 B DRAM across 2 banks (1024 B per bank), bank size is 4096 B (allocated: 3500 B, free: 596 B, largest free block: 512 B). After subtracting 1 dependency range(s) and 0 additional occupied range(s), 512 B remained placeable across 1 window(s), largest 512 B';

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
            requestedBytes: 2048,
            numBanks: 2,
            bytesPerBank: 1024,
            largestFreeBlockBytes: 512,
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

describe('getAllocationFailureSummary', () => {
    it('states the free space only when the message reports it', () => {
        const legacy = parseAllocationFailure(operationError(LEGACY_OUT_OF_MEMORY))!;
        const current = parseAllocationFailure(operationError(OUT_OF_MEMORY))!;

        expect(getAllocationFailureSummary(legacy)).toBe(
            'Requested 3.13 MiB L1 across 4 banks (800 KiB per bank, bank size 1.32 MiB)',
        );
        expect(getAllocationFailureSummary(current)).toContain('; free 374 KiB, largest free block 293 KiB');
    });

    it('labels the buffer type for display', () => {
        const dependencies = parseAllocationFailure(
            operationError(OUT_OF_MEMORY_WITH_DEPENDENCIES.replace('B DRAM across', 'B L1_SMALL across')),
        )!;

        expect(getAllocationFailureSummary(dependencies)).toMatch(/^Requested 2 KiB L1 Small across 2 banks/);
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
