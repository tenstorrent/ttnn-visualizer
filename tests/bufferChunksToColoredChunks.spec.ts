// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { bufferChunksToColoredChunks } from '../src/functions/getChartData';
import { DecoratedBufferChunk } from '../src/model/APIData';
import { BufferType } from '../src/model/BufferType';

function chunk(overrides: Partial<DecoratedBufferChunk> = {}): DecoratedBufferChunk {
    return {
        operation_id: 1,
        device_id: 0,
        address: 100,
        bank_id: 1,
        core_x: 0,
        core_y: 0,
        chunk_address: 1000,
        chunk_size: 48,
        page_size: 24,
        num_pages: 2,
        buffer_type: BufferType.L1,
        rank: 0,
        id: '1_0_100_1_0_0_1_0',
        color: '#000000',
        ...overrides,
    };
}

describe('bufferChunksToColoredChunks', () => {
    it('projects a chunk to {address, size, color}', () => {
        const result = bufferChunksToColoredChunks([chunk({ address: 200, chunk_size: 1024, color: '#abcdef' })]);

        expect(result).toEqual([{ address: 200, size: 1024, color: '#abcdef' }]);
    });

    it('preserves chunk order', () => {
        const result = bufferChunksToColoredChunks([
            chunk({ address: 300, chunk_size: 16 }),
            chunk({ address: 100, chunk_size: 8 }),
            chunk({ address: 200, chunk_size: 32 }),
        ]);

        expect(result.map((c) => c.address)).toEqual([300, 100, 200]);
    });

    it('uses chunk_size for the rendered size, not page_size or num_pages', () => {
        const result = bufferChunksToColoredChunks([chunk({ chunk_size: 4096, page_size: 24, num_pages: 170 })]);

        expect(result[0].size).toBe(4096);
    });

    it('passes color through unchanged', () => {
        const result = bufferChunksToColoredChunks([
            chunk({ address: 100, color: '#abcdef' }),
            chunk({ address: 200, color: 'rgb(1, 2, 3)' }),
        ]);

        expect(result[0].color).toBe('#abcdef');
        expect(result[1].color).toBe('rgb(1, 2, 3)');
    });

    it('returns an empty array for empty input', () => {
        expect(bufferChunksToColoredChunks([])).toEqual([]);
    });
});
