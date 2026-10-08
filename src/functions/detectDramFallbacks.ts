// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AllocationFailureKind } from '../definitions/AllocationFailure';
import {
    DRAM_FALLBACK_IGNORED_ARGUMENT_PATTERN,
    DRAM_FALLBACK_RETRY_WINDOW_OPERATIONS,
    DramFallbackSignal,
} from '../definitions/DramFallback';
import { AllocationFailure } from '../model/AllocationFailure';
import { Operation, OperationDescription, Tensor } from '../model/APIData';
import { BufferType, BufferTypeLabel, StringBufferTypeToBufferType, isL1BufferType } from '../model/BufferType';
import { DramFallback } from '../model/DramFallback';
import { getMemoryConfigBufferType } from './parseMemoryConfig';

type OperationArgument = Pick<OperationDescription['arguments'][number], 'name' | 'value'>;

export type DramFallbackOperation = Pick<Operation, 'id' | 'name' | 'inputs' | 'outputs'> & {
    arguments: OperationArgument[];
};

/**
 * DRAM outputs the op allocated itself. An output at an input's address is a view of that
 * input — `ttnn.reshape` takes this path and ignores its memory config — and accounted for
 * every DRAM output that asked for L1 across the reports measured for #2081.
 */
const getUnaliasedDramOutputs = ({ inputs, outputs }: DramFallbackOperation): Tensor[] => {
    const inputAddresses = new Set(inputs.map(({ address }) => address).filter((address) => address !== null));

    return outputs.filter(
        ({ address, buffer_type: bufferType }) =>
            bufferType === BufferType.DRAM && (address === null || !inputAddresses.has(address)),
    );
};

const getRequestedBufferTypes = (operation: DramFallbackOperation): BufferType[] =>
    operation.arguments
        .filter(({ name }) => !DRAM_FALLBACK_IGNORED_ARGUMENT_PATTERN.test(name))
        .map(({ value }) => getMemoryConfigBufferType(value))
        .filter((bufferType): bufferType is BufferType => bufferType !== null);

const isL1AllocationFailure = (failure: AllocationFailure): boolean => {
    switch (failure.kind) {
        case AllocationFailureKind.BANK_OUT_OF_MEMORY:
        case AllocationFailureKind.BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES:
            return failure.bufferType !== null && isL1BufferType(StringBufferTypeToBufferType[failure.bufferType]);
        case AllocationFailureKind.CIRCULAR_BUFFERS_BEYOND_L1:
        case AllocationFailureKind.CIRCULAR_BUFFERS_CLASH:
            return true;
        default: {
            // A new kind fails to compile here until it is classified.
            const unhandled: never = failure;
            return unhandled;
        }
    }
};

/**
 * Likely L1-to-DRAM fallbacks, keyed by operation id. Inferred, not recorded: tt-metal writes
 * nothing when an op falls back. Operations must be in id order, as `/api/operations` serves them.
 */
export const getDramFallbacks = (
    operations: DramFallbackOperation[],
    allocationFailureByOpId: Map<number, AllocationFailure>,
): Map<number, DramFallback> => {
    const dramFallbackByOpId = new Map<number, DramFallback>();

    for (const operation of operations) {
        const requested = getRequestedBufferTypes(operation);
        // A mixed request, such as an L1 output with a DRAM scratch buffer, cannot be pinned on the output.
        const requestsOnlyL1 = requested.length > 0 && requested.every(isL1BufferType);
        const dramOutputs = requestsOnlyL1 ? getUnaliasedDramOutputs(operation) : [];

        if (dramOutputs.length > 0) {
            dramFallbackByOpId.set(operation.id, {
                signal: DramFallbackSignal.ARGUMENT_MISMATCH,
                operationId: operation.id,
                requestedBufferType: requested[0],
                dramOutputCount: dramOutputs.length,
                outputCount: operation.outputs.length,
            });
        }
    }

    // Last, so a recorded failure followed by DRAM outranks a bare argument mismatch.
    operations.forEach((failedOperation, index) => {
        const failure = allocationFailureByOpId.get(failedOperation.id);

        if (!failure || !isL1AllocationFailure(failure)) {
            return;
        }

        const retry = operations
            .slice(index + 1, index + 1 + DRAM_FALLBACK_RETRY_WINDOW_OPERATIONS)
            .find(({ name }) => name === failedOperation.name);
        const dramOutputs = retry ? getUnaliasedDramOutputs(retry) : [];

        if (retry && dramOutputs.length > 0) {
            dramFallbackByOpId.set(retry.id, {
                signal: DramFallbackSignal.RETRY_AFTER_FAILURE,
                operationId: retry.id,
                failedOperationId: failedOperation.id,
                failedOperationName: failedOperation.name,
                dramOutputCount: dramOutputs.length,
                outputCount: retry.outputs.length,
            });
        }
    });

    return dramFallbackByOpId;
};

/** One line saying what was asked for against where the outputs landed. */
export const getDramFallbackSummary = (fallback: DramFallback): string => {
    const outputs = `${fallback.dramOutputCount} of ${fallback.outputCount} outputs in DRAM`;

    switch (fallback.signal) {
        case DramFallbackSignal.ARGUMENT_MISMATCH:
            return `Requested ${BufferTypeLabel[fallback.requestedBufferType]}; ${outputs}.`;
        case DramFallbackSignal.RETRY_AFTER_FAILURE:
            return `Retries operation ${fallback.failedOperationId} (${fallback.failedOperationName}), which failed to allocate L1; ${outputs}.`;
        default: {
            // A new signal fails to compile here until it has a summary.
            const unhandled: never = fallback;
            return unhandled;
        }
    }
};
