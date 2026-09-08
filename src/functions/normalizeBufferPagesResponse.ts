// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { BufferChunk, LegacyBufferPage } from '../model/APIData';

/**
 * Client-side fallback for backends that have not been upgraded to return
 * pre-aggregated ``BufferChunk`` rows from ``/api/buffer-pages``.
 *
 * The aggregation mirrors the server-side ``GROUP BY`` in
 * ``_aggregate_buffer_pages_to_chunks`` so the two paths produce identical
 * data: one row per ``(operation_id, device_id, address, bank_id, core_x,
 * core_y, buffer_type)`` group, with ``chunk_address = MIN(page_address)``
 * and ``chunk_size = MAX(page_address + page_size) - MIN(page_address)``.
 */
export const aggregatePagesToChunks = (pages: LegacyBufferPage[]): BufferChunk[] => {
    const groups = new Map<
        string,
        {
            chunk: Omit<BufferChunk, 'chunk_address' | 'chunk_size' | 'page_size' | 'num_pages'> & {
                rank: number;
            };
            start: number;
            end: number;
            maxPageSize: number;
            count: number;
        }
    >();

    for (const page of pages) {
        const rank = page.rank ?? 0;
        const key = [
            page.operation_id,
            page.device_id,
            page.address,
            page.bank_id,
            page.core_x,
            page.core_y,
            page.buffer_type,
            rank,
        ].join('|');

        const pageEnd = page.page_address + page.page_size;
        const existing = groups.get(key);
        if (existing) {
            if (page.page_address < existing.start) {
                existing.start = page.page_address;
            }
            if (pageEnd > existing.end) {
                existing.end = pageEnd;
            }
            if (page.page_size > existing.maxPageSize) {
                existing.maxPageSize = page.page_size;
            }
            existing.count += 1;
        } else {
            groups.set(key, {
                chunk: {
                    operation_id: page.operation_id,
                    device_id: page.device_id,
                    address: page.address,
                    bank_id: page.bank_id,
                    core_x: page.core_x,
                    core_y: page.core_y,
                    buffer_type: page.buffer_type,
                    rank,
                    id: `${page.operation_id}_${page.device_id}_${page.address}_${page.bank_id}_${page.core_x}_${page.core_y}_${page.buffer_type}_${rank}`,
                },
                start: page.page_address,
                end: pageEnd,
                maxPageSize: page.page_size,
                count: 1,
            });
        }
    }

    return Array.from(groups.values()).map(({ chunk, start, end, maxPageSize, count }) => ({
        ...chunk,
        chunk_address: start,
        chunk_size: end - start,
        page_size: maxPageSize,
        num_pages: count,
    }));
};

/**
 * Return ``true`` when a row from ``/api/buffer-pages`` was emitted by a
 * legacy backend (per-page rows) rather than an aggregating backend
 * (per-chunk rows). The discriminator is the presence of ``page_index``,
 * which only exists on legacy rows.
 */
export const isLegacyBufferPageRow = (row: unknown): row is LegacyBufferPage =>
    typeof row === 'object' && row !== null && 'page_index' in row && !('chunk_address' in row);

/**
 * Normalize a heterogeneous ``/api/buffer-pages`` response into
 * ``BufferChunk[]``. New backends already return chunks; old backends
 * return raw pages and we collapse them in the browser.
 */
export const normalizeBufferPagesResponse = (rows: unknown[]): BufferChunk[] => {
    if (rows.length === 0) {
        return [];
    }
    const sample = rows[0];
    if (isLegacyBufferPageRow(sample)) {
        return aggregatePagesToChunks(rows as LegacyBufferPage[]);
    }
    return rows as BufferChunk[];
};
