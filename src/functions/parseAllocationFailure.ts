// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AllocationFailureKind } from '../definitions/AllocationFailure';
import { AllocationFailure, BankAllocationFailure } from '../model/AllocationFailure';
import { Operation } from '../model/APIData';
import { StringBufferType, StringBufferTypeLabel } from '../model/BufferType';
import { formatMemorySize, getMemoryAddress } from './math';

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

            // tt-metal's own figures can show plenty free when dependencies took it, so the
            // placeable figures replace them whenever the message carries both.
            if (failure.placeableBytes !== null && failure.largestPlaceableBytes !== null) {
                return `${request}; placeable ${formatBytes(failure.placeableBytes)}, largest placeable window ${formatBytes(failure.largestPlaceableBytes)}`;
            }

            if (failure.freeBytes === null || failure.largestFreeBlockBytes === null) {
                return request;
            }

            return `${request}; free ${formatBytes(failure.freeBytes)}, largest free block ${formatBytes(failure.largestFreeBlockBytes)}`;
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

const getBankFailureDiagnosis = (failure: BankAllocationFailure): string | null => {
    const { bytesPerBank } = failure;
    const hasPlaceable = failure.placeableBytes !== null && failure.largestPlaceableBytes !== null;
    const free = hasPlaceable ? failure.placeableBytes : failure.freeBytes;
    const largest = hasPlaceable ? failure.largestPlaceableBytes : failure.largestFreeBlockBytes;
    const isDependencies = failure.kind === AllocationFailureKind.BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES;
    // tt-metal clamps only interleaved L1 to an address limit, but counts free space past
    // it; the message does not say whether the buffer was sharded.
    const mayBeAddressLimited = !isDependencies && failure.bufferType === StringBufferType.L1;
    const needed = formatBytes(bytesPerBank);

    if (free === null || largest === null) {
        if (bytesPerBank > failure.bankSizeBytes) {
            return `Needs ${needed} per bank, more than an empty bank holds (${formatBytes(failure.bankSizeBytes)}): it cannot fit in this buffer type spread across ${failure.numBanks} banks.`;
        }

        // Older tt-metal reports only the bank size, so there is nothing to compare against.
        return null;
    }

    if (largest >= bytesPerBank) {
        if (isDependencies) {
            return `A free block of ${formatBytes(largest)} could hold the ${needed} per bank, but space reserved by dependent allocators overlaps it.`;
        }

        if (mayBeAddressLimited) {
            return `A free block of ${formatBytes(largest)} could hold the ${needed} per bank, but an interleaved L1 buffer may only use the interleaved region, and that block lies outside it.`;
        }

        return `A free block of ${formatBytes(largest)} could hold the ${needed} per bank, but the allocator could not use it; the message does not say why.`;
    }

    if (free >= bytesPerBank) {
        return `Fragmented: ${formatBytes(free)} free per bank, but no single block holds ${needed}; the largest is ${formatBytes(largest)}.`;
    }

    const shortfall = `Short by ${formatBytes(bytesPerBank - free)} per bank: needs ${needed}, ${formatBytes(free)} free.`;

    return mayBeAddressLimited
        ? `${shortfall} An interleaved buffer can use only part of that free space, so it may be short by more.`
        : shortfall;
};

/** Why the allocation did not fit, from its figures; `null` when they cannot say. */
export const getAllocationFailureDiagnosis = (failure: AllocationFailure, showHex = false): string | null => {
    switch (failure.kind) {
        case AllocationFailureKind.BANK_OUT_OF_MEMORY:
        case AllocationFailureKind.BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES:
            return getBankFailureDiagnosis(failure);
        case AllocationFailureKind.CIRCULAR_BUFFERS_BEYOND_L1:
            return `Over L1 by ${formatBytes(failure.circularBufferRegionEnd - failure.maxL1Bytes)}.`;
        case AllocationFailureKind.CIRCULAR_BUFFERS_CLASH:
            return `Overlaps the L1 buffer at ${getMemoryAddress(failure.l1BufferAddress, showHex)} by ${formatBytes(failure.circularBufferRegionEnd - failure.l1BufferAddress)}.`;
        default: {
            // A new kind fails to compile here until it has a diagnosis.
            const unhandled: never = failure;
            return unhandled;
        }
    }
};
