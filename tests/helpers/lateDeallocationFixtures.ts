// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { LateDeallocationRunStart } from '../../src/definitions/LateDeallocation';
import { TensorDeallocationReport } from '../../src/model/BufferSummary';

/**
 * One builder for the late-deallocation report shape, so specs that assert on
 * the same overlay can't drift into different notions of a default tensor.
 */
export const buildTensorDeallocationReport = (
    overrides: Partial<TensorDeallocationReport> = {},
): TensorDeallocationReport => ({
    id: 1,
    address: 1024,
    lastOperationId: 10,
    lastConsumerOperationId: 5,
    consumerName: 'ttnn.add',
    ...overrides,
});

export const buildLateDeallocationRunStart = (
    overrides: Partial<LateDeallocationRunStart> = {},
): LateDeallocationRunStart => ({
    opId: 1,
    rowIndex: 0,
    tensors: [buildTensorDeallocationReport()],
    ...overrides,
});
