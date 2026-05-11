// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { BuffersByOperation } from '../model/APIData';

type FlattenedBuffer = {
    address: number;
    size: number;
    opId: number;
    opName: string;
    buffer: BuffersByOperation['buffers'][number];
};

const DRAM_GAP_SPLIT_THRESHOLD_RATIO = 2;

/** Min/max address extent for all buffers (operation list order is irrelevant). */
export function getBufferAddressBounds(operations: BuffersByOperation[]): { start: number; end: number } | null {
    let minAddress = Number.POSITIVE_INFINITY;
    let maxAddress = Number.NEGATIVE_INFINITY;

    for (const operation of operations) {
        for (const buffer of operation.buffers) {
            minAddress = Math.min(minAddress, buffer.address);
            maxAddress = Math.max(maxAddress, buffer.address + buffer.size);
        }
    }

    if (!Number.isFinite(minAddress) || !Number.isFinite(maxAddress)) {
        return null;
    }

    return { start: minAddress, end: maxAddress };
}

/** Address window for zoom; falls back to `[0, fullMemorySize]` when there are no buffers. */
export function getBufferAddressZoomRange(operations: BuffersByOperation[], fullMemorySize: number): [number, number] {
    const bounds = getBufferAddressBounds(operations);
    if (!bounds) {
        return [0, fullMemorySize];
    }
    return [bounds.start, bounds.end];
}

export function memoryZoomPaddingForRange(start: number, end: number, paddingRatio: number): number {
    return (end - start) * paddingRatio;
}

export function countBuffersAcrossOperations(operations: BuffersByOperation[]): number {
    let count = 0;

    for (const op of operations) {
        count += op.buffers.length;
    }

    return count;
}

/** Split operations into address-space clusters (DRAM gap split). */
export function getSplitBuffers(data: BuffersByOperation[]): BuffersByOperation[][] {
    const buffers: FlattenedBuffer[] = [];

    data.forEach((operation) => {
        operation.buffers.forEach((buffer) => {
            buffers.push({
                address: buffer.address,
                size: buffer.size,
                opId: operation.id,
                opName: operation.name,
                buffer,
            });
        });
    });

    buffers.sort((a, b) => a.address - b.address);

    const lastDataPoint = buffers.at(-1);
    const splitThreshold = lastDataPoint
        ? (lastDataPoint.address + lastDataPoint.size) / DRAM_GAP_SPLIT_THRESHOLD_RATIO
        : 0;

    const result: FlattenedBuffer[][] = [];
    let currentArray: FlattenedBuffer[] = [];

    for (let i = 0; i < buffers.length; i++) {
        const thisPosition = buffers[i].address;
        const lastPosition = buffers[i - 1]?.address ?? 0;

        if (thisPosition - lastPosition > splitThreshold) {
            result.push(currentArray);
            currentArray = [];
        }

        currentArray.push(buffers[i]);
    }

    if (currentArray.length > 0) {
        result.push(currentArray);
    }

    return result.map((buffersGroup) => {
        const operationsMap = new Map<number, BuffersByOperation>();

        buffersGroup.forEach((entry) => {
            if (!operationsMap.has(entry.opId)) {
                operationsMap.set(entry.opId, { id: entry.opId, name: entry.opName, buffers: [] });
            }
            operationsMap.get(entry.opId)!.buffers.push(entry.buffer);
        });

        return Array.from(operationsMap.values());
    });
}
