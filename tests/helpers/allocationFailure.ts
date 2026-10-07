// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AllocationFailureKind } from '../../src/definitions/AllocationFailure';
import { BankAllocationFailure } from '../../src/model/AllocationFailure';
import { StringBufferType } from '../../src/model/BufferType';

/** An out-of-memory failure as older tt-metal records it: no free-space figures. */
export const makeAllocationFailure = (overrides: Partial<BankAllocationFailure> = {}): BankAllocationFailure => ({
    operationId: 240,
    operationName: 'ttnn.conv2d',
    kind: AllocationFailureKind.BANK_OUT_OF_MEMORY,
    bufferType: StringBufferType.L1,
    requestedBytes: 3276800,
    numBanks: 4,
    bytesPerBank: 819200,
    bankSizeBytes: 1382720,
    allocatedBytes: null,
    freeBytes: null,
    largestFreeBlockBytes: null,
    ...overrides,
});
