// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    aggregatePagesToChunks,
    isLegacyBufferPageRow,
    normalizeBufferPagesResponse,
} from '../src/functions/normalizeBufferPagesResponse';
import { BufferChunk, LegacyBufferPage } from '../src/model/APIData';
import { BufferType } from '../src/model/BufferType';

function page(overrides: Partial<LegacyBufferPage> = {}): LegacyBufferPage {
    return {
        operation_id: 1,
        device_id: 0,
        address: 100,
        bank_id: 1,
        core_x: 0,
        core_y: 0,
        page_index: 0,
        page_address: 1000,
        page_size: 24,
        buffer_type: BufferType.L1,
        id: '1_0',
        ...overrides,
    };
}

function chunk(overrides: Partial<BufferChunk> = {}): BufferChunk {
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
        ...overrides,
    };
}

describe('isLegacyBufferPageRow', () => {
    it('returns true for rows with page_index and no chunk_address', () => {
        expect(isLegacyBufferPageRow(page())).toBe(true);
    });

    it('returns false for chunk rows', () => {
        expect(isLegacyBufferPageRow(chunk())).toBe(false);
    });

    it('returns false for null / non-object input', () => {
        expect(isLegacyBufferPageRow(null)).toBe(false);
        expect(isLegacyBufferPageRow(undefined)).toBe(false);
        expect(isLegacyBufferPageRow(42)).toBe(false);
    });
});

describe('aggregatePagesToChunks', () => {
    it('collapses contiguous pages into one chunk and computes chunk_size by extent', () => {
        const result = aggregatePagesToChunks([
            page({ page_index: 0, page_address: 1000, page_size: 24 }),
            page({ page_index: 1, page_address: 1024, page_size: 24 }),
        ]);

        expect(result).toHaveLength(1);
        const c = result[0];
        expect(c.chunk_address).toBe(1000);
        // max(page_addr + page_size) - min(page_addr) = (1024+24) - 1000 = 48
        expect(c.chunk_size).toBe(48);
        expect(c.page_size).toBe(24);
        expect(c.num_pages).toBe(2);
    });

    it('emits separate chunks for different (bank, core) groups', () => {
        const result = aggregatePagesToChunks([
            page({ bank_id: 1, core_x: 0, core_y: 0, page_address: 1000 }),
            page({ bank_id: 2, core_x: 1, core_y: 0, page_address: 2000, page_size: 16 }),
        ]);

        expect(result).toHaveLength(2);
        const sorted = result.sort((a, b) => a.bank_id - b.bank_id);
        expect(sorted[0].bank_id).toBe(1);
        expect(sorted[0].chunk_address).toBe(1000);
        expect(sorted[1].bank_id).toBe(2);
        expect(sorted[1].chunk_address).toBe(2000);
        expect(sorted[1].chunk_size).toBe(16);
    });

    it('keeps different operation_ids in separate groups', () => {
        const result = aggregatePagesToChunks([page({ operation_id: 1 }), page({ operation_id: 2 })]);
        expect(result).toHaveLength(2);
        expect(result.map((c) => c.operation_id).sort()).toEqual([1, 2]);
    });

    it('does not merge rows with different rank values', () => {
        const result = aggregatePagesToChunks([page({ rank: 0 }), page({ rank: 1 })]);
        expect(result).toHaveLength(2);
        expect(result.map((c) => c.rank).sort()).toEqual([0, 1]);
    });

    it('defaults missing rank to 0', () => {
        const result = aggregatePagesToChunks([page({ rank: undefined })]);
        expect(result[0].rank).toBe(0);
    });

    it('synthesizes the chunk id from the full grouping tuple', () => {
        const result = aggregatePagesToChunks([
            page({ operation_id: 5, address: 200, bank_id: 3, core_x: 2, core_y: 4 }),
        ]);
        // op_device_addr_bank_x_y_buffer-type_rank — page() defaults give
        // device_id=0, buffer_type=L1(1), rank=0 (the omitted-rank default).
        expect(result[0].id).toBe(`5_0_200_3_2_4_${BufferType.L1}_0`);
    });

    it('emits distinct ids for groups that only differ on device, rank, or buffer_type', () => {
        const result = aggregatePagesToChunks([
            page({ device_id: 0, buffer_type: BufferType.DRAM, rank: 0 }),
            page({ device_id: 1, buffer_type: BufferType.DRAM, rank: 0 }),
            page({ device_id: 0, buffer_type: BufferType.L1, rank: 0 }),
            page({ device_id: 0, buffer_type: BufferType.DRAM, rank: 1 }),
        ]);

        const ids = new Set(result.map((c) => c.id));
        expect(ids.size).toBe(4);
    });

    it('takes the max page_size when sizes vary within a group', () => {
        const result = aggregatePagesToChunks([
            page({ page_address: 1000, page_size: 24 }),
            page({ page_address: 1024, page_size: 32 }),
        ]);
        expect(result[0].page_size).toBe(32);
    });

    it('returns an empty array for empty input', () => {
        expect(aggregatePagesToChunks([])).toEqual([]);
    });
});

describe('normalizeBufferPagesResponse', () => {
    it('returns chunks unchanged when the backend already aggregated', () => {
        const chunks = [chunk({ address: 100 }), chunk({ address: 200, id: '1_0_200_1_0_0_1_0' })];
        expect(normalizeBufferPagesResponse(chunks)).toEqual(chunks);
    });

    it('aggregates legacy page rows on the client', () => {
        const result = normalizeBufferPagesResponse([
            page({ page_address: 1000, page_size: 24, page_index: 0 }),
            page({ page_address: 1024, page_size: 24, page_index: 1 }),
        ]);

        expect(result).toHaveLength(1);
        expect(result[0].chunk_size).toBe(48);
        expect(result[0].num_pages).toBe(2);
    });

    it('returns an empty array for an empty response', () => {
        expect(normalizeBufferPagesResponse([])).toEqual([]);
    });
});
