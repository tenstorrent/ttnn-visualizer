// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { DramFallbackSignal } from '../definitions/DramFallback';
import { BufferType } from './BufferType';

export interface DramFallbackOutputs {
    operationId: number;
    dramOutputCount: number;
    outputCount: number;
}

/** The op asked for L1 in its memory config arguments, yet an output it allocated is in DRAM. */
export interface ArgumentMismatchFallback extends DramFallbackOutputs {
    signal: DramFallbackSignal.ARGUMENT_MISMATCH;
    requestedBufferType: BufferType;
}

/** A same-named op that ran just after one failed to allocate L1, with an output in DRAM. */
export interface RetryAfterFailureFallback extends DramFallbackOutputs {
    signal: DramFallbackSignal.RETRY_AFTER_FAILURE;
    failedOperationId: number;
    failedOperationName: string;
}

/** A likely L1-to-DRAM fallback, inferred from the memory report rather than recorded in it. */
export type DramFallback = ArgumentMismatchFallback | RetryAfterFailureFallback;
