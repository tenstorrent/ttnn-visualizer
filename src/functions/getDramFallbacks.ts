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
import { DramFallback, DramFallbackOutputs } from '../model/DramFallback';
import { getMemoryConfigBufferType, isMemoryConfigValue } from './parseMemoryConfig';
import assertNever from './assertNever';

type OperationArgument = Pick<OperationDescription['arguments'][number], 'name' | 'value'>;

export type DramFallbackOperation = Pick<Operation, 'id' | 'name' | 'inputs' | 'outputs'> & {
    arguments: OperationArgument[];
};

/**
 * DRAM outputs the op allocated itself. An output at a DRAM input's address on the same device
 * is a view of that input — `ttnn.reshape` takes this path and ignores its memory config — and
 * accounted for every DRAM output that asked for L1 across the reports measured for #2081.
 * L1 and each device's DRAM are separate address spaces, so an equal number elsewhere is not a view.
 */
const getUnaliasedDramOutputs = ({ inputs, outputs }: DramFallbackOperation): Tensor[] => {
    const isViewOfInput = ({ address, device_id: deviceId }: Tensor): boolean =>
        address !== null &&
        inputs.some(
            (input) =>
                input.buffer_type === BufferType.DRAM && input.address === address && input.device_id === deviceId,
        );

    return outputs.filter((output) => output.buffer_type === BufferType.DRAM && !isViewOfInput(output));
};

/** The fields every signal reports, or `null` when the op allocated no DRAM output itself. */
const getDramFallbackOutputs = (operation: DramFallbackOperation): DramFallbackOutputs | null => {
    const dramOutputs = getUnaliasedDramOutputs(operation);

    return dramOutputs.length > 0
        ? { operationId: operation.id, dramOutputCount: dramOutputs.length, outputCount: operation.outputs.length }
        : null;
};

/**
 * The L1 buffer type the op's memory config arguments ask for, or `null` unless every one of
 * them asks for L1. A mixed request, such as an L1 output with a DRAM scratch buffer, cannot be
 * pinned on the output, and a config whose buffer type is unknown cannot be shown to ask for L1.
 */
const getL1Request = (operation: DramFallbackOperation): BufferType | null => {
    const requested = operation.arguments
        .filter(({ name, value }) => !DRAM_FALLBACK_IGNORED_ARGUMENT_PATTERN.test(name) && isMemoryConfigValue(value))
        .map(({ value }) => getMemoryConfigBufferType(value));

    return requested.length > 0 && requested.every(isL1BufferType) ? requested[0] : null;
};

const isL1AllocationFailure = (failure: AllocationFailure): boolean => {
    switch (failure.kind) {
        case AllocationFailureKind.BANK_OUT_OF_MEMORY:
        case AllocationFailureKind.BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES:
            return failure.bufferType !== null && isL1BufferType(StringBufferTypeToBufferType[failure.bufferType]);
        case AllocationFailureKind.CIRCULAR_BUFFERS_BEYOND_L1:
        case AllocationFailureKind.CIRCULAR_BUFFERS_CLASH:
            return true;
        default:
            return assertNever(failure);
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
        // Outputs first: ruling out a DRAM output is cheaper than parsing every argument.
        const outputs = getDramFallbackOutputs(operation);
        const requestedBufferType = outputs ? getL1Request(operation) : null;

        if (outputs && requestedBufferType !== null) {
            dramFallbackByOpId.set(operation.id, {
                ...outputs,
                signal: DramFallbackSignal.ARGUMENT_MISMATCH,
                requestedBufferType,
            });
        }
    }

    if (allocationFailureByOpId.size === 0) {
        return dramFallbackByOpId;
    }

    // Last, so a recorded failure followed by DRAM outranks a bare argument mismatch. Only the
    // first same-named op in the window counts: if it stayed in L1, the retry worked.
    operations.forEach((failedOperation, index) => {
        const failure = allocationFailureByOpId.get(failedOperation.id);

        if (!failure || !isL1AllocationFailure(failure)) {
            return;
        }

        const retry = operations
            .slice(index + 1, index + 1 + DRAM_FALLBACK_RETRY_WINDOW_OPERATIONS)
            .find(({ name }) => name === failedOperation.name);
        const outputs = retry ? getDramFallbackOutputs(retry) : null;

        if (outputs) {
            dramFallbackByOpId.set(outputs.operationId, {
                ...outputs,
                signal: DramFallbackSignal.RETRY_AFTER_FAILURE,
                failedOperationId: failedOperation.id,
                failedOperationName: failedOperation.name,
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
        default:
            return assertNever(fallback);
    }
};
