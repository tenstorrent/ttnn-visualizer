// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AllocationFailureKind } from '../definitions/AllocationFailure';
import { StringBufferType } from './BufferType';

/**
 * An allocation failure read out of an operation's recorded error. Figures a given
 * message does not carry are `null`: circular-buffer failures name no banks, and
 * out-of-memory messages from older tt-metal stop at the bank size.
 */
export interface AllocationFailure {
    operationId: number;
    operationName: string;
    kind: AllocationFailureKind;
    bufferType: StringBufferType | null;
    requestedBytes: number | null;
    numBanks: number | null;
    bytesPerBank: number | null;
    bankSizeBytes: number | null;
    allocatedBytes: number | null;
    freeBytes: number | null;
    largestFreeBlockBytes: number | null;
    coreRange: string | null;
    l1BufferAddress: number | null;
    circularBufferRegionEnd: number | null;
    maxL1Bytes: number | null;
}

/** An allocation failure as the performance view lists it, joined to the linked perf report. */
export interface AllocationFailureListing {
    failure: AllocationFailure;
    /** Device operations whose launch did not complete; empty when the capture did not record one. */
    failedDeviceOperations: string[];
    /** Perf rows of this operation's earlier device operations, which did run. Usually zero. */
    linkedRowCount: number;
}
