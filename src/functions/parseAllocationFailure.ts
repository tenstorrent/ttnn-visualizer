// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AllocationFailureKind } from '../definitions/AllocationFailure';
import { AllocationFailure } from '../model/AllocationFailure';
import { OperationError } from '../model/APIData';
import { StringBufferType } from '../model/BufferType';
import { formatMemorySize } from './math';

// Each pattern restates a tt-metal format string; when a message stops matching, that
// source is where the format moved. None is anchored: the stored message wraps the
// text in a `TT_FATAL @ file:line:` / `TT_THROW` header and a trailing backtrace.

// `tt_metal/impl/allocator/bank_manager.cpp`. Older tt-metal ends at "bank size is
// only {} B", without the allocator statistics.
const BANK_OUT_OF_MEMORY_PATTERN =
    /Out of Memory: Not enough space to allocate (\d+) B (\w+) buffer across (\d+) banks, where each bank needs to store (\d+) B, but bank size is (?:only )?(\d+) B(?: \(allocated: (\d+) B, free: (\d+) B, largest free block: (\d+) B\))?/;

// `tt_metal/impl/allocator/bank_manager.cpp`
const BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES_PATTERN =
    /Out of Memory: Not enough space after considering dependencies to allocate (\d+) B (\w+) across (\d+) banks \((\d+) B per bank\), bank size is (\d+) B \(allocated: (\d+) B, free: (\d+) B, largest free block: (\d+) B\)/;

// `tt_metal/impl/program/program.cpp`
const CIRCULAR_BUFFERS_BEYOND_L1_PATTERN =
    /Statically allocated circular buffers on core range (.+?) grow to (\d+) B which is beyond max L1 size of (\d+) B/;

// `tt_metal/impl/program/program.cpp`
const CIRCULAR_BUFFERS_CLASH_PATTERN =
    /Statically allocated circular buffers in program \d+ clash with L1 buffers on core range (.+?)\. L1 buffer allocated at (\d+) and static circular buffer region ends at (\d+)/;

const STRING_BUFFER_TYPES = new Set<string>(Object.values(StringBufferType));

const toNumber = (value: string | undefined): number | null => (value === undefined ? null : Number(value));

const toBufferType = (value: string): StringBufferType | null =>
    STRING_BUFFER_TYPES.has(value) ? (value as StringBufferType) : null;

const EMPTY_FIGURES = {
    bufferType: null,
    requestedBytes: null,
    numBanks: null,
    bytesPerBank: null,
    bankSizeBytes: null,
    allocatedBytes: null,
    freeBytes: null,
    largestFreeBlockBytes: null,
    coreRange: null,
    l1BufferAddress: null,
    circularBufferRegionEnd: null,
    maxL1Bytes: null,
} as const;

/** The allocation failure an operation's error records, or `null` for any other error. */
export const parseAllocationFailure = (error: OperationError | null | undefined): AllocationFailure | null => {
    const message = error?.error_message;

    if (!error || typeof message !== 'string') {
        return null;
    }

    const identity = { operationId: error.operation_id, operationName: error.operation_name };

    const bankMatch =
        message.match(BANK_OUT_OF_MEMORY_PATTERN) ?? message.match(BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES_PATTERN);

    if (bankMatch) {
        const [, size, bufferType, numBanks, perBank, bankSize, allocated, free, largestFree] = bankMatch;

        return {
            ...identity,
            ...EMPTY_FIGURES,
            kind: BANK_OUT_OF_MEMORY_PATTERN.test(message)
                ? AllocationFailureKind.BANK_OUT_OF_MEMORY
                : AllocationFailureKind.BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES,
            bufferType: toBufferType(bufferType),
            requestedBytes: toNumber(size),
            numBanks: toNumber(numBanks),
            bytesPerBank: toNumber(perBank),
            bankSizeBytes: toNumber(bankSize),
            allocatedBytes: toNumber(allocated),
            freeBytes: toNumber(free),
            largestFreeBlockBytes: toNumber(largestFree),
        };
    }

    const beyondMatch = message.match(CIRCULAR_BUFFERS_BEYOND_L1_PATTERN);

    if (beyondMatch) {
        const [, coreRange, regionEnd, maxL1] = beyondMatch;

        return {
            ...identity,
            ...EMPTY_FIGURES,
            kind: AllocationFailureKind.CIRCULAR_BUFFERS_BEYOND_L1,
            bufferType: StringBufferType.L1,
            coreRange,
            circularBufferRegionEnd: toNumber(regionEnd),
            maxL1Bytes: toNumber(maxL1),
        };
    }

    const clashMatch = message.match(CIRCULAR_BUFFERS_CLASH_PATTERN);

    if (clashMatch) {
        const [, coreRange, l1Address, regionEnd] = clashMatch;

        return {
            ...identity,
            ...EMPTY_FIGURES,
            kind: AllocationFailureKind.CIRCULAR_BUFFERS_CLASH,
            bufferType: StringBufferType.L1,
            coreRange,
            l1BufferAddress: toNumber(l1Address),
            circularBufferRegionEnd: toNumber(regionEnd),
        };
    }

    return null;
};

const formatBytes = (bytes: number | null): string => formatMemorySize(bytes ?? undefined);

/** One line describing what the allocation asked for against what was available. */
export const getAllocationFailureSummary = (failure: AllocationFailure): string => {
    switch (failure.kind) {
        case AllocationFailureKind.BANK_OUT_OF_MEMORY:
        case AllocationFailureKind.BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES: {
            const bufferType = failure.bufferType ? ` ${failure.bufferType}` : '';
            const request =
                `Requested ${formatBytes(failure.requestedBytes)}${bufferType} across ${failure.numBanks} banks ` +
                `(${formatBytes(failure.bytesPerBank)} per bank, bank size ${formatBytes(failure.bankSizeBytes)})`;

            // Older tt-metal does not report what was free.
            if (failure.freeBytes === null || failure.largestFreeBlockBytes === null) {
                return request;
            }

            return `${request}; free ${formatBytes(failure.freeBytes)}, largest free block ${formatBytes(failure.largestFreeBlockBytes)}`;
        }
        case AllocationFailureKind.CIRCULAR_BUFFERS_BEYOND_L1:
            return `Circular buffers on ${failure.coreRange} end at ${failure.circularBufferRegionEnd}, beyond the L1 size of ${formatBytes(failure.maxL1Bytes)}`;
        case AllocationFailureKind.CIRCULAR_BUFFERS_CLASH:
            return `Circular buffers on ${failure.coreRange} end at ${failure.circularBufferRegionEnd}, past an L1 buffer at ${failure.l1BufferAddress}`;
        default:
            return '';
    }
};
