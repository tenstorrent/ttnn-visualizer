// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Buffer, BuffersByOperation, DeviceInfo } from '../model/APIData';

export interface L1PressureMetrics {
    fullnessPercent: number;
    freeSegments: number;
    largestFreeBytes: number;
    largestFreePercent: number;
}

export enum L1PressureStatus {
    Loading = 'loading',
    Unavailable = 'unavailable',
    Ready = 'ready',
}

// Discriminated result so consumers can reserve the L1 column while inputs are still resolving
// (avoiding a mid-render layout jump) and hide it only when the data is genuinely unavailable.
export interface L1PressureResult {
    status: L1PressureStatus;
    data: Map<number, L1PressureMetrics> | null;
}

export interface L1PressureBuildParams {
    hasProfilerReport: boolean;
    isError: boolean;
    isLoading: boolean;
    buffersByOperation: BuffersByOperation[] | undefined;
    devices: DeviceInfo[] | undefined;
    l1SmallBuffers: Buffer[] | undefined;
    l1Start: number;
    l1End: number;
}

export function buildL1PressureResult({
    hasProfilerReport,
    isError,
    isLoading,
    buffersByOperation,
    devices,
    l1SmallBuffers,
    l1Start,
    l1End,
}: L1PressureBuildParams): L1PressureResult {
    if (!hasProfilerReport || isError) {
        return { status: L1PressureStatus.Unavailable, data: null };
    }

    const inputsResolved =
        !isLoading && buffersByOperation !== undefined && devices !== undefined && l1SmallBuffers !== undefined;

    if (!inputsResolved) {
        // useBuffers is disabled when no memory report is selected; React Query stays idle with
        // isLoading false and data undefined — must not report Loading indefinitely.
        if (!isLoading && buffersByOperation === undefined) {
            return { status: L1PressureStatus.Unavailable, data: null };
        }

        return { status: L1PressureStatus.Loading, data: null };
    }

    if (l1End <= l1Start) {
        return { status: L1PressureStatus.Unavailable, data: null };
    }

    const pressureByOperation = new Map<number, L1PressureMetrics>();

    for (const operation of buffersByOperation) {
        pressureByOperation.set(operation.id, computeL1PressureForOperation(operation.buffers, l1Start, l1End));
    }

    return { status: L1PressureStatus.Ready, data: pressureByOperation };
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

    // Each device has its own physical L1 sharing the same address layout, so buffers must be
    // grouped by device_id before deduping/merging — otherwise same-offset buffers on different
    // devices collide and the merged layout is meaningless. We surface the worst-case (most full)
    // device, since that is the binding L1 constraint for the operation, and keep its fragmentation
    // figures internally consistent (segments + largest-free come from that same device).
    const buffersByDevice = new Map<number, Buffer[]>();

    for (const buffer of buffers) {
        const deviceBuffers = buffersByDevice.get(buffer.device_id);

        if (deviceBuffers) {
            deviceBuffers.push(buffer);
        } else {
            buffersByDevice.set(buffer.device_id, [buffer]);
        }
    }

    const deviceGroups = [...buffersByDevice.values()];

    if (deviceGroups.length === 0) {
        return computeMetricsForDevice([], l1Start, l1End, usableSize);
    }

    return deviceGroups
        .map((deviceBuffers) => computeMetricsForDevice(deviceBuffers, l1Start, l1End, usableSize))
        .reduce((worst, metrics) => (metrics.fullnessPercent > worst.fullnessPercent ? metrics : worst));
}

function computeMetricsForDevice(
    buffers: Buffer[],
    l1Start: number,
    l1End: number,
    usableSize: number,
): L1PressureMetrics {
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
