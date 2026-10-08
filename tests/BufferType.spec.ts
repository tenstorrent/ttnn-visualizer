// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { BufferType, isL1BufferType } from '../src/model/BufferType';

describe('isL1BufferType', () => {
    it.each([BufferType.L1, BufferType.L1_SMALL])('is true for %s', (bufferType) => {
        expect(isL1BufferType(bufferType)).toBe(true);
    });

    // DRAM is 0, so a truthiness check would wrongly pass it through as "no type".
    it.each([BufferType.DRAM, BufferType.SYSTEM_MEMORY, BufferType.TRACE, null, undefined])(
        'is false for %s',
        (bufferType) => {
            expect(isL1BufferType(bufferType)).toBe(false);
        },
    );
});
