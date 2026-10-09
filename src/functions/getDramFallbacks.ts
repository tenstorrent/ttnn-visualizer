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
import {
    ArgumentMismatchFallback,
    DramFallback,
    DramFallbackOutputs,
    RetryAfterFailureFallback,
} from '../model/DramFallback';
import { getMemoryConfigBufferType, isMemoryConfigValue } from './parseMemoryConfig';
import assertNever from './assertNever';

type OperationArgument = Pick<OperationDescription['arguments'][number], 'name' | 'value'>;

export type DramFallbackOperation = Pick<Operation, 'id' | 'name' | 'inputs' | 'outputs'> & {
    arguments: OperationArgument[];
};

interface DeviceAddress {
    deviceId: number | null;
    address: number;
}

/**
 * Where the tensor sits on each device. Older multi-device reports leave a mesh tensor's
 * `address` null and record one address per device, indexed by device id, instead.
 */
const getDeviceAddresses = ({
    address,
    device_id: deviceId,
    device_addresses: deviceAddresses,
}: Tensor): DeviceAddress[] =>
    address !== null
        ? [{ deviceId, address }]
        : (deviceAddresses ?? []).flatMap((deviceAddress, index) =>
              deviceAddress !== null ? [{ deviceId: index, address: deviceAddress }] : [],
          );

const shapePattern = /^(?:Shape|torch\.Size)\(\[([\d,\s]*)\]\)$/;

/** The tensor's element count, or `null` when its shape can't be read. */
const getElementCount = (shape: string | undefined): number | null => {
    const dimensions = shape?.match(shapePattern)?.[1];

    return dimensions === undefined
        ? null
        : dimensions
              .split(',')
              .filter((dimension) => dimension.trim() !== '')
              .reduce((count, dimension) => count * Number(dimension), 1);
};

/**
 * Whether the output may be a view of the input: same element count, and the same address on
 * the same device. L1 and each device's DRAM are separate address spaces, so an equal number
 * elsewhere is not a view. When either address is unknown, aliasing can't be ruled out.
 * The element count separates a view from a new buffer reusing a freed input's address, as a
 * conv2d's prepared weights do after `deallocate_activation`.
 */
const mayAlias = (output: Tensor, input: Tensor): boolean => {
    const outputCount = getElementCount(output.shape);
    const inputCount = getElementCount(input.shape);

    if (outputCount !== null && inputCount !== null && outputCount !== inputCount) {
        return false;
    }

    const outputAddresses = getDeviceAddresses(output);
    const inputAddresses = getDeviceAddresses(input);

    return (
        outputAddresses.length === 0 ||
        inputAddresses.length === 0 ||
        outputAddresses.some(({ deviceId, address }) =>
            inputAddresses.some(
                (inputAddress) => inputAddress.deviceId === deviceId && inputAddress.address === address,
            ),
        )
    );
};

/**
 * DRAM outputs the op allocated itself. An output that may be a view of a DRAM input is left
 * out — `ttnn.reshape` takes this path and ignores its memory config — and accounted for every
 * DRAM output that asked for L1 across the reports measured for #2081.
 */
const getUnaliasedDramOutputs = ({ inputs, outputs }: DramFallbackOperation): Tensor[] => {
    const dramInputs = inputs.filter((input) => input.buffer_type === BufferType.DRAM);

    return outputs.filter(
        (output) => output.buffer_type === BufferType.DRAM && !dramInputs.some((input) => mayAlias(output, input)),
    );
};

/**
 * The fields every signal reports, or `null` unless the op allocated a DRAM output itself and
 * kept none in L1. Conv ops also return their prepared weights and bias, which are always new
 * DRAM buffers, so an L1 output means the output that was asked for stayed in L1.
 */
const getDramFallbackOutputs = (operation: DramFallbackOperation): DramFallbackOutputs | null => {
    if (operation.outputs.some((output) => isL1BufferType(output.buffer_type))) {
        return null;
    }

    const dramOutputs = getUnaliasedDramOutputs(operation);

    return dramOutputs.length > 0
        ? { operationId: operation.id, dramOutputCount: dramOutputs.length, outputCount: operation.outputs.length }
        : null;
};

/** The buffer type each of the op's output memory config arguments declares, `null` where unknown. */
const getRequestedBufferTypes = (operation: DramFallbackOperation): (BufferType | null)[] =>
    operation.arguments
        .filter(({ name, value }) => !DRAM_FALLBACK_IGNORED_ARGUMENT_PATTERN.test(name) && isMemoryConfigValue(value))
        .map(({ value }) => getMemoryConfigBufferType(value));

/**
 * The L1 buffer type the op's memory config arguments ask for, or `null` unless every one of
 * them asks for L1. A mixed request, such as an L1 output with a DRAM scratch buffer, cannot be
 * pinned on the output, and a config whose buffer type is unknown cannot be shown to ask for L1.
 */
const getL1Request = (operation: DramFallbackOperation): BufferType | null => {
    const requested = getRequestedBufferTypes(operation);

    return requested.length > 0 && requested.every(isL1BufferType) ? requested[0] : null;
};

/**
 * Whether the failure shows the op tried to put its output in L1. A bank failure must be in
 * L1, on an op that did not ask for DRAM. A circular-buffer failure concerns the program's
 * buffers, not the output, so only the op's own L1 request ties it to the output: without
 * one, an op whose output defaults to DRAM would turn its retry into a fallback.
 */
const isL1OutputFailure = (failure: AllocationFailure, failedOperation: DramFallbackOperation): boolean => {
    switch (failure.kind) {
        case AllocationFailureKind.BANK_OUT_OF_MEMORY:
        case AllocationFailureKind.BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES:
            return (
                failure.bufferType !== null &&
                isL1BufferType(StringBufferTypeToBufferType[failure.bufferType]) &&
                !getRequestedBufferTypes(failedOperation).includes(BufferType.DRAM)
            );
        case AllocationFailureKind.CIRCULAR_BUFFERS_BEYOND_L1:
        case AllocationFailureKind.CIRCULAR_BUFFERS_CLASH:
            return getL1Request(failedOperation) !== null;
        default:
            return assertNever(failure);
    }
};

/** The op asked for L1 in its memory config arguments, yet allocated its output in DRAM. */
const getArgumentMismatch = (operation: DramFallbackOperation): ArgumentMismatchFallback | null => {
    // Outputs first: ruling out a DRAM output is cheaper than parsing every argument.
    const outputs = getDramFallbackOutputs(operation);
    const requestedBufferType = outputs ? getL1Request(operation) : null;

    return outputs && requestedBufferType !== null
        ? { ...outputs, signal: DramFallbackSignal.ARGUMENT_MISMATCH, requestedBufferType }
        : null;
};

/**
 * Retries of ops that failed to allocate L1, keyed by the retry's operation id. Only the first
 * same-named op in the window counts: if it stayed in L1, the retry worked. A later failure
 * overwrites an earlier one, so a retry is credited to the nearest failure before it.
 */
const getRetriesAfterFailure = (
    operations: DramFallbackOperation[],
    allocationFailureByOpId: Map<number, AllocationFailure>,
): Map<number, RetryAfterFailureFallback> => {
    const retryByOpId = new Map<number, RetryAfterFailureFallback>();

    if (allocationFailureByOpId.size === 0) {
        return retryByOpId;
    }

    operations.forEach((failedOperation, index) => {
        const failure = allocationFailureByOpId.get(failedOperation.id);

        if (!failure || !isL1OutputFailure(failure, failedOperation)) {
            return;
        }

        const retry = operations
            .slice(index + 1, index + 1 + DRAM_FALLBACK_RETRY_WINDOW_OPERATIONS)
            .find(({ name }) => name === failedOperation.name);
        const outputs = retry ? getDramFallbackOutputs(retry) : null;

        if (outputs) {
            retryByOpId.set(outputs.operationId, {
                ...outputs,
                signal: DramFallbackSignal.RETRY_AFTER_FAILURE,
                failedOperationId: failedOperation.id,
                failedOperationName: failedOperation.name,
            });
        }
    });

    return retryByOpId;
};

/**
 * Likely L1-to-DRAM fallbacks, keyed by operation id. Inferred, not recorded: tt-metal writes
 * nothing when an op falls back. Operations must be in id order, as `/api/operations` serves them.
 * A recorded failure followed by DRAM outranks a bare argument mismatch on the same op.
 */
export const getDramFallbacks = (
    operations: DramFallbackOperation[],
    allocationFailureByOpId: Map<number, AllocationFailure>,
): Map<number, DramFallback> => {
    const retryByOpId = getRetriesAfterFailure(operations, allocationFailureByOpId);
    const dramFallbackByOpId = new Map<number, DramFallback>();

    for (const operation of operations) {
        const fallback = retryByOpId.get(operation.id) ?? getArgumentMismatch(operation);

        if (fallback) {
            dramFallbackByOpId.set(operation.id, fallback);
        }
    }

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
