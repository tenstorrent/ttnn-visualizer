// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { parsePerfRowTensorAttributes } from '../src/functions/parsePerfRowTensorAttributes';
import { BufferType } from '../src/model/BufferType';
import { DeviceOperationLayoutTypes } from '../src/model/APIData';

describe('parsePerfRowTensorAttributes', () => {
    it('extracts L1 buffer type and TILE layout from input_0_memory', () => {
        const parsed = parsePerfRowTensorAttributes({ input_0_memory: 'DEV_0_L1_TILE' });

        expect(parsed.buffer_type).toBe(BufferType.L1);
        expect(parsed.layout).toBe(DeviceOperationLayoutTypes.TILE);
    });

    it('extracts DRAM buffer type and INTERLEAVED layout', () => {
        const parsed = parsePerfRowTensorAttributes({ input_0_memory: 'DEV_0_DRAM_INTERLEAVED' });

        expect(parsed.buffer_type).toBe(BufferType.DRAM);
        expect(parsed.layout).toBe(DeviceOperationLayoutTypes.INTERLEAVED);
    });

    it('returns null fields when input_0_memory is empty', () => {
        const parsed = parsePerfRowTensorAttributes({ input_0_memory: '' });

        expect(parsed.buffer_type).toBeNull();
        expect(parsed.layout).toBeNull();
    });

    it('returns null fields when input_0_memory is unrecognized', () => {
        const parsed = parsePerfRowTensorAttributes({ input_0_memory: 'UNKNOWN_MEMORY' });

        expect(parsed.buffer_type).toBeNull();
        expect(parsed.layout).toBeNull();
    });

    it('returns a null layout when the captured layout is not a known DeviceOperationLayoutTypes member', () => {
        const parsed = parsePerfRowTensorAttributes({ input_0_memory: 'DEV_0_L1_FOO' });

        expect(parsed.buffer_type).toBe(BufferType.L1);
        expect(parsed.layout).toBeNull();
    });
});
