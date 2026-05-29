// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Buffer } from '../model/APIData';

export interface L1PressureMetrics {
    fullnessPercent: number;
    freeSegments: number;
    largestFreeBytes: number;
    largestFreePercent: number;
}

interface MemoryChunk {
    address: number;
    size: number;
}

// Perf-table v1 uses DB buffers from useBuffers(BufferType.L1) only — not captured-graph CBs
// or buffer_allocate nodes that OperationDetails.memoryData() also considers.
export function computeL1PressureForOperation(buffers: Buffer[], l1Start: number, l1End: number): L1PressureMetrics {
    const usableSize = l1End - l1Start;

    if (usableSize <= 0) {
        return {
            fullnessPercent: 0,
            freeSegments: 0,
            largestFreeBytes: 0,
            largestFreePercent: 0,
        };
    }

    const clippedChunks = dedupeAndClipBuffers(buffers, l1Start, l1End);
    const mergedChunks = mergeOverlappingChunks(clippedChunks);
    const gapSizes = computeGapSizes(mergedChunks, l1Start, l1End);
    const usedBytes = mergedChunks.reduce((sum, chunk) => sum + chunk.size, 0);
    const largestFreeBytes = gapSizes.reduce((largest, gap) => (gap > largest ? gap : largest), 0);

    return {
        fullnessPercent: (usedBytes / usableSize) * 100,
        freeSegments: gapSizes.length,
        largestFreeBytes,
        largestFreePercent: (largestFreeBytes / usableSize) * 100,
    };
}

function dedupeAndClipBuffers(buffers: Buffer[], l1Start: number, l1End: number): MemoryChunk[] {
    const byAddress = new Map<number, number>();

    for (const buffer of buffers) {
        if (buffer.address != null) {
            const existingSize = byAddress.get(buffer.address);
            if (existingSize === undefined || buffer.size > existingSize) {
                byAddress.set(buffer.address, buffer.size);
            }
        }
    }

    const clippedChunks: MemoryChunk[] = [];

    for (const [address, size] of byAddress.entries()) {
        const clipped = clipChunk({ address, size }, l1Start, l1End);
        if (clipped) {
            clippedChunks.push(clipped);
        }
    }

    return clippedChunks;
}

function clipChunk(chunk: MemoryChunk, l1Start: number, l1End: number): MemoryChunk | null {
    const chunkEnd = chunk.address + chunk.size;

    if (chunkEnd <= l1Start || chunk.address >= l1End) {
        return null;
    }

    const address = Math.max(chunk.address, l1Start);
    const end = Math.min(chunkEnd, l1End);

    return {
        address,
        size: end - address,
    };
}

function mergeOverlappingChunks(chunks: MemoryChunk[]): MemoryChunk[] {
    if (chunks.length === 0) {
        return [];
    }

    const sorted = [...chunks].sort((a, b) => a.address - b.address);
    const merged: MemoryChunk[] = [{ ...sorted[0] }];

    for (let index = 1; index < sorted.length; index++) {
        const chunk = sorted[index];
        const lastChunk = merged[merged.length - 1];

        if (lastChunk.address + lastChunk.size >= chunk.address) {
            lastChunk.size = Math.max(lastChunk.size, chunk.address + chunk.size - lastChunk.address);
        } else {
            merged.push({ ...chunk });
        }
    }

    return merged;
}

function computeGapSizes(mergedChunks: MemoryChunk[], l1Start: number, l1End: number): number[] {
    const usableSize = l1End - l1Start;

    if (usableSize <= 0) {
        return [];
    }

    if (mergedChunks.length === 0) {
        return [usableSize];
    }

    const gaps: number[] = [];
    let cursor = l1Start;

    for (const chunk of mergedChunks) {
        if (chunk.address > cursor) {
            gaps.push(chunk.address - cursor);
        }

        cursor = Math.max(cursor, chunk.address + chunk.size);
    }

    if (cursor < l1End) {
        gaps.push(l1End - cursor);
    }

    return gaps;
}
