// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AllocationFailureKind, AllocationFailureReason } from '../definitions/AllocationFailure';
import {
    AllocationFailure,
    AllocationFailureDetail,
    AllocationFailureDiagnosis,
    BankAllocationFailure,
} from '../model/AllocationFailure';
import { Operation } from '../model/APIData';
import { StringBufferType, StringBufferTypeLabel } from '../model/BufferType';
import { formatMemorySize, getMemoryAddress } from './math';
import { getFailedDeviceOperationNames } from './scopeOutcomes';

// Each pattern restates a tt-metal format string; when a message stops matching, that
// source is where the format moved. None is anchored: the stored message wraps the
// text in a `TT_FATAL @ file:line:` / `TT_THROW` header and a trailing backtrace.

// `tt_metal/impl/allocator/bank_manager.cpp`. Older tt-metal ends at "bank size is
// only {} B", without the allocator statistics.
const BANK_OUT_OF_MEMORY_PATTERN =
    /Out of Memory: Not enough space to allocate (\d+) B (\w+) buffer across (\d+) banks, where each bank needs to store (\d+) B, but bank size is (?:only )?(\d+) B(?: \(allocated: (\d+) B, free: (\d+) B, largest free block: (\d+) B\))?/;

// `tt_metal/impl/allocator/bank_manager.cpp`. Older tt-metal ends at the allocator
// statistics, without what remained placeable after subtracting dependencies.
const BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES_PATTERN =
    /Out of Memory: Not enough space after considering dependencies to allocate (\d+) B (\w+) across (\d+) banks \((\d+) B per bank\), bank size is (\d+) B \(allocated: (\d+) B, free: (\d+) B, largest free block: (\d+) B\)(?:\. After subtracting \d+ dependency range\(s\) and \d+ additional occupied range\(s\), (\d+) B remained placeable across \d+ window\(s\), largest (\d+) B)?/;

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

/**
 * The allocation failure an operation's error records, or `null` for any other error.
 *
 * Takes the operation rather than its error: the nested error the API returns leaves
 * out the operation's id and name (`ErrorRecord.to_nested_dict`).
 */
export const parseAllocationFailure = ({
    id,
    name,
    error,
}: Pick<Operation, 'id' | 'name' | 'error'>): AllocationFailure | null => {
    const message = error?.error_message;

    if (typeof message !== 'string') {
        return null;
    }

    const operation = { operationId: id, operationName: name };

    const bankMatch = message.match(BANK_OUT_OF_MEMORY_PATTERN);

    if (bankMatch) {
        const [, size, bufferType, numBanks, perBank, bankSize, allocated, free, largestFree] = bankMatch;

        return {
            ...operation,
            kind: AllocationFailureKind.BANK_OUT_OF_MEMORY,
            bufferType: toBufferType(bufferType),
            requestedBytes: Number(size),
            numBanks: Number(numBanks),
            bytesPerBank: Number(perBank),
            bankSizeBytes: Number(bankSize),
            allocatedBytes: toNumber(allocated),
            freeBytes: toNumber(free),
            largestFreeBlockBytes: toNumber(largestFree),
            placeableBytes: null,
            largestPlaceableBytes: null,
        };
    }

    const dependenciesMatch = message.match(BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES_PATTERN);

    if (dependenciesMatch) {
        const [, size, bufferType, numBanks, perBank, bankSize, allocated, free, largestFree, placeable, largest] =
            dependenciesMatch;

        return {
            ...operation,
            kind: AllocationFailureKind.BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES,
            bufferType: toBufferType(bufferType),
            requestedBytes: Number(size),
            numBanks: Number(numBanks),
            bytesPerBank: Number(perBank),
            bankSizeBytes: Number(bankSize),
            allocatedBytes: toNumber(allocated),
            freeBytes: toNumber(free),
            largestFreeBlockBytes: toNumber(largestFree),
            placeableBytes: toNumber(placeable),
            largestPlaceableBytes: toNumber(largest),
        };
    }

    const beyondMatch = message.match(CIRCULAR_BUFFERS_BEYOND_L1_PATTERN);

    if (beyondMatch) {
        const [, coreRange, regionEnd, maxL1] = beyondMatch;

        return {
            ...operation,
            kind: AllocationFailureKind.CIRCULAR_BUFFERS_BEYOND_L1,
            coreRange,
            circularBufferRegionEnd: Number(regionEnd),
            maxL1Bytes: Number(maxL1),
        };
    }

    const clashMatch = message.match(CIRCULAR_BUFFERS_CLASH_PATTERN);

    if (clashMatch) {
        const [, coreRange, l1Address, regionEnd] = clashMatch;

        return {
            ...operation,
            kind: AllocationFailureKind.CIRCULAR_BUFFERS_CLASH,
            coreRange,
            l1BufferAddress: Number(l1Address),
            circularBufferRegionEnd: Number(regionEnd),
        };
    }

    return null;
};

/**
 * The allocation failure an operation's error records, and the device operations whose
 * launch it stopped; `null` for any other error. Walks the captured graph only for a failure.
 */
export const getAllocationFailureDetail = (
    operation: Pick<Operation, 'id' | 'name' | 'error' | 'device_operations'>,
): AllocationFailureDetail | null => {
    const failure = parseAllocationFailure(operation);

    return failure
        ? { failure, failedDeviceOperations: getFailedDeviceOperationNames(operation.device_operations) }
        : null;
};

const formatBytes = (bytes: number): string => formatMemorySize(bytes);

/** One line describing what the allocation asked for against what was available. */
export const getAllocationFailureSummary = (failure: AllocationFailure, showHex = false): string => {
    switch (failure.kind) {
        case AllocationFailureKind.BANK_OUT_OF_MEMORY:
        case AllocationFailureKind.BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES: {
            const bufferType = failure.bufferType ? ` ${StringBufferTypeLabel[failure.bufferType]}` : '';
            const request =
                `Requested ${formatBytes(failure.requestedBytes)}${bufferType} across ${failure.numBanks} banks ` +
                `(${formatBytes(failure.bytesPerBank)} per bank, bank size ${formatBytes(failure.bankSizeBytes)})`;

            if (failure.freeBytes === null || failure.largestFreeBlockBytes === null) {
                return request;
            }

            const free = `${request}; free ${formatBytes(failure.freeBytes)}, largest free block ${formatBytes(failure.largestFreeBlockBytes)}`;

            // Placeable is what is left of the free blocks large enough for the request once
            // other allocators' ranges are taken out, so it adds to the free figures rather
            // than standing in for them.
            if (failure.placeableBytes !== null && failure.largestPlaceableBytes !== null) {
                return `${free}; placeable ${formatBytes(failure.placeableBytes)}, largest placeable window ${formatBytes(failure.largestPlaceableBytes)}`;
            }

            return free;
        }
        case AllocationFailureKind.CIRCULAR_BUFFERS_BEYOND_L1:
            return `Circular buffers on ${failure.coreRange} grow to ${formatBytes(failure.circularBufferRegionEnd)}, beyond the L1 size of ${formatBytes(failure.maxL1Bytes)}`;
        case AllocationFailureKind.CIRCULAR_BUFFERS_CLASH:
            return `Circular buffers on ${failure.coreRange} end at ${getMemoryAddress(failure.circularBufferRegionEnd, showHex)}, past an L1 buffer at ${getMemoryAddress(failure.l1BufferAddress, showHex)}`;
        default: {
            // A new kind fails to compile here until it has a summary.
            const unhandled: never = failure;
            return unhandled;
        }
    }
};

// tt-metal clamps only interleaved L1 to an address limit, on both checks, but counts free
// space past it; the message does not say whether the buffer was sharded.
const INTERLEAVED_L1_CAVEAT =
    'An interleaved L1 buffer can use only the part of that free space inside the interleaved region';
const INTERLEAVED_L1_BLOCK_CAVEAT = 'An interleaved L1 buffer is also limited to the interleaved region.';

const diagnose = (reason: AllocationFailureReason, detail: string): AllocationFailureDiagnosis => ({ reason, detail });

const getBankFailureDiagnosis = (failure: BankAllocationFailure): AllocationFailureDiagnosis | null => {
    const { bytesPerBank, freeBytes: free, largestFreeBlockBytes: largest } = failure;
    const needed = formatBytes(bytesPerBank);
    const isL1 = failure.bufferType === StringBufferType.L1;

    // Ahead of the free figures: no amount of freeing makes room for this.
    if (bytesPerBank > failure.bankSizeBytes) {
        return diagnose(
            AllocationFailureReason.LARGER_THAN_EMPTY_BANK,
            `Needs ${needed} per bank, more than an empty bank holds (${formatBytes(failure.bankSizeBytes)}): it cannot fit in this buffer type spread across ${failure.numBanks} banks.`,
        );
    }

    if (free === null || largest === null) {
        // Older tt-metal reports only the bank size, so there is nothing to compare against.
        return null;
    }

    if (largest >= bytesPerBank) {
        const fits = `The largest free block, ${formatBytes(largest)}, could hold the ${needed} per bank`;

        if (failure.kind !== AllocationFailureKind.BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES) {
            // The plain error fires only when no free block is large enough; a block that ends
            // up here was outgrown by the request rounded up to the minimum allocation size.
            // A block below the interleaved limit throws a different error.
            return diagnose(
                AllocationFailureReason.FREE_BLOCK_COULD_HOLD_IT,
                `${fits}, but the allocator could not use it; the message does not say why.`,
            );
        }

        const reserved =
            failure.largestPlaceableBytes === null
                ? `${fits}, but space reserved by other allocators overlaps it.`
                : `${fits}, but other allocators' reservations leave a placeable window of at most ${formatBytes(failure.largestPlaceableBytes)}.`;

        return diagnose(
            AllocationFailureReason.FREE_BLOCK_COULD_HOLD_IT,
            isL1 ? `${reserved} ${INTERLEAVED_L1_BLOCK_CAVEAT}` : reserved,
        );
    }

    if (free >= bytesPerBank) {
        const fragmented = `${formatBytes(free)} free per bank, but no single block holds ${needed}; the largest is ${formatBytes(largest)}.`;

        return diagnose(
            AllocationFailureReason.FRAGMENTED,
            isL1 ? `${fragmented} ${INTERLEAVED_L1_CAVEAT}.` : fragmented,
        );
    }

    const shortfall = `Short by ${formatBytes(bytesPerBank - free)} per bank: needs ${needed}, ${formatBytes(free)} free.`;

    return diagnose(
        AllocationFailureReason.NOT_ENOUGH_FREE_SPACE,
        isL1 ? `${shortfall} ${INTERLEAVED_L1_CAVEAT}, so it may be short by more.` : shortfall,
    );
};

/** Why the allocation did not fit, from its figures; `null` when they cannot say. */
export const getAllocationFailureDiagnosis = (
    failure: AllocationFailure,
    showHex = false,
): AllocationFailureDiagnosis | null => {
    switch (failure.kind) {
        case AllocationFailureKind.BANK_OUT_OF_MEMORY:
        case AllocationFailureKind.BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES:
            return getBankFailureDiagnosis(failure);
        case AllocationFailureKind.CIRCULAR_BUFFERS_BEYOND_L1:
            return diagnose(
                AllocationFailureReason.BEYOND_END_OF_L1,
                `The circular buffers run ${formatBytes(failure.circularBufferRegionEnd - failure.maxL1Bytes)} past the end of L1.`,
            );
        case AllocationFailureKind.CIRCULAR_BUFFERS_CLASH:
            return diagnose(
                AllocationFailureReason.OVERLAPS_L1_BUFFER,
                `The circular buffers overlap the L1 buffer at ${getMemoryAddress(failure.l1BufferAddress, showHex)} by ${formatBytes(failure.circularBufferRegionEnd - failure.l1BufferAddress)}.`,
            );
        default: {
            // A new kind fails to compile here until it has a diagnosis.
            const unhandled: never = failure;
            return unhandled;
        }
    }
};
