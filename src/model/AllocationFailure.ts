// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AllocationFailureKind } from '../definitions/AllocationFailure';
import { StringBufferType } from './BufferType';

interface AllocationFailureOperation {
    operationId: number;
    operationName: string;
}

/** A buffer that did not fit its banks. */
export interface BankAllocationFailure extends AllocationFailureOperation {
    kind: AllocationFailureKind.BANK_OUT_OF_MEMORY | AllocationFailureKind.BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES;
    /** `null` when tt-metal names a buffer type this app does not know. */
    bufferType: StringBufferType | null;
    requestedBytes: number;
    numBanks: number;
    bytesPerBank: number;
    bankSizeBytes: number;
    // Older tt-metal stops at the bank size, without the allocator statistics.
    allocatedBytes: number | null;
    freeBytes: number | null;
    largestFreeBlockBytes: number | null;
}

/** Static circular buffers that grow past the end of L1. */
export interface CircularBuffersBeyondL1Failure extends AllocationFailureOperation {
    kind: AllocationFailureKind.CIRCULAR_BUFFERS_BEYOND_L1;
    coreRange: string;
    circularBufferRegionEnd: number;
    maxL1Bytes: number;
}

/** Static circular buffers that run into an L1 buffer. */
export interface CircularBuffersClashFailure extends AllocationFailureOperation {
    kind: AllocationFailureKind.CIRCULAR_BUFFERS_CLASH;
    coreRange: string;
    circularBufferRegionEnd: number;
    l1BufferAddress: number;
}

/** An allocation failure read out of an operation's recorded error. */
export type AllocationFailure = BankAllocationFailure | CircularBuffersBeyondL1Failure | CircularBuffersClashFailure;

/** An allocation failure as the performance view lists it, joined to the linked perf report. */
export interface AllocationFailureListing {
    failure: AllocationFailure;
    /** Device operations whose launch did not complete; empty when the capture did not record one. */
    failedDeviceOperations: string[];
    /** Perf rows of this operation's earlier device operations, which did run. Usually zero. */
    linkedRowCount: number;
}
