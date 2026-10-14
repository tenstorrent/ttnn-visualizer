// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { DramFallbackSignal } from '../../src/definitions/DramFallback';
import { ArgumentMismatchFallback } from '../../src/model/DramFallback';
import { BufferType } from '../../src/model/BufferType';

/** An op that asked for L1 and wrote its only output to DRAM. */
export const makeDramFallback = (overrides: Partial<ArgumentMismatchFallback> = {}): ArgumentMismatchFallback => ({
    signal: DramFallbackSignal.ARGUMENT_MISMATCH,
    operationId: 42,
    requestedBufferType: BufferType.L1,
    dramOutputCount: 1,
    outputCount: 1,
    ...overrides,
});
