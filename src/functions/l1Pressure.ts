// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Buffer, DeviceInfo } from '../model/APIData';
import { L1PressureBuildParams, L1PressureMetrics, L1PressureResult, L1PressureStatus } from '../model/L1Pressure';

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

    const deviceWindows = resolveDeviceL1Windows(devices);

    if (deviceWindows.size === 0 && l1End <= l1Start) {
        return { status: L1PressureStatus.Unavailable, data: null };
    }

    const pressureByOperation = new Map<number, L1PressureMetrics>();

    for (const operation of buffersByOperation) {
        pressureByOperation.set(
            operation.id,
            mostConstrainedDevice(operation.buffers, { start: l1Start, end: l1End }, deviceWindows).metrics,
        );
    }

    return { status: L1PressureStatus.Ready, data: pressureByOperation };
}

interface MemoryChunk {
    address: number;
    size: number;
}

interface L1Window {
    start: number;
    end: number;
}

export interface DeviceL1Pressure {
    // Null only when no device has geometry and the operation holds no buffers.
    deviceId: number | null;
    allocatedBytes: number;
    metrics: L1PressureMetrics;
}

function resolveDeviceL1Windows(devices: DeviceInfo[] | undefined): Map<number, L1Window> {
    const windows = new Map<number, L1Window>();

    if (!devices) {
        return windows;
    }

    for (const device of devices) {
        const bankSize = device.l1_bank_size ?? 0;
        const workerSize = device.worker_l1_size ?? 0;
        if (bankSize > 0 && workerSize > 0) {
            const start = Math.max(0, device.address_at_first_l1_cb_buffer ?? 0);
            const end = Math.min(workerSize, start + bankSize);
            if (end > start) {
                windows.set(device.device_id, { start, end });
            }
        }
    }

    return windows;
}

// Perf-table v1 uses DB buffers from useBuffers(BufferType.L1) only — not captured-graph CBs
// or buffer_allocate nodes that OperationDetails.memoryData() also considers.
// Mirrored as `_compute_l1_pressure` in `backend/ttnn_visualizer/agent/operations.py`, held to
// this function by tests/l1PressureParity.spec.ts. The port returns null where this returns a
// fully free window: for an operation with no buffer rows, and when no device has geometry.
export function computeL1PressureForOperation(
    buffers: Buffer[],
    l1Start: number,
    l1End: number,
    devices?: DeviceInfo[],
): L1PressureMetrics {
    return computeMostConstrainedL1Device(buffers, l1Start, l1End, devices).metrics;
}

// As computeL1PressureForOperation, with the device it reports on.
export function computeMostConstrainedL1Device(
    buffers: Buffer[],
    l1Start: number,
    l1End: number,
    devices?: DeviceInfo[],
): DeviceL1Pressure {
    return mostConstrainedDevice(buffers, { start: l1Start, end: l1End }, resolveDeviceL1Windows(devices));
}

// The device a tensor is least likely to fit on: smallest largest free block, then fullest, then
// most allocated, then lowest device_id — the order `_pressure_rank` gives in the agent's port.
const rankMostConstrained = (a: DeviceL1Pressure, b: DeviceL1Pressure): number =>
    a.metrics.largestFreeBytes - b.metrics.largestFreeBytes ||
    b.metrics.fullnessPercent - a.metrics.fullnessPercent ||
    b.allocatedBytes - a.allocatedBytes ||
    (a.deviceId ?? 0) - (b.deviceId ?? 0);

function mostConstrainedDevice(
    buffers: Buffer[],
    markerWindow: L1Window,
    deviceWindows: Map<number, L1Window>,
): DeviceL1Pressure {
    const unavailable: DeviceL1Pressure = {
        deviceId: null,
        allocatedBytes: 0,
        metrics: { fullnessPercent: 0, freeSegments: 0, largestFreeBytes: 0, largestFreePercent: 0 },
    };

    // Each device has its own physical L1 sharing the same address layout, so buffers must be
    // grouped by device_id before deduping/merging — otherwise same-offset buffers on different
    // devices collide and the merged layout is meaningless. When device geometry is present, each
    // device is bounded by [address_at_first_l1_cb_buffer, min(worker_l1_size, address_at_first_l1_cb_buffer
    // + l1_bank_size)) so reserved L1 Small space is not counted as free L1 (#2172). Without it, the
    // L1 start and L1 Small markers bound every device.
    const [firstWindow] = deviceWindows.values();
    const fallbackWindow = firstWindow ?? markerWindow;

    if (fallbackWindow.end <= fallbackWindow.start) {
        return unavailable;
    }

    const buffersByDevice = new Map<number, Buffer[]>();

    for (const buffer of buffers) {
        const deviceBuffers = buffersByDevice.get(buffer.device_id);

        if (deviceBuffers) {
            deviceBuffers.push(buffer);
        } else {
            buffersByDevice.set(buffer.device_id, [buffer]);
        }
    }

    const candidates = [...buffersByDevice].map(([deviceId, deviceBuffers]) =>
        computeDevicePressure(deviceBuffers, deviceId, deviceWindows.get(deviceId) ?? fallbackWindow),
    );

    // A device holding nothing scores the same as any other empty device with its window, so each
    // distinct window is measured once, for its lowest device_id.
    const emptyByWindow = new Map<string, number>();

    for (const [deviceId, window] of deviceWindows) {
        const key = `${window.start}:${window.end}`;
        const lowest = emptyByWindow.get(key);
        if (!buffersByDevice.has(deviceId) && (lowest === undefined || deviceId < lowest)) {
            emptyByWindow.set(key, deviceId);
        }
    }

    for (const deviceId of emptyByWindow.values()) {
        candidates.push(computeDevicePressure([], deviceId, deviceWindows.get(deviceId) ?? fallbackWindow));
    }

    if (candidates.length === 0) {
        return computeDevicePressure([], null, fallbackWindow);
    }

    return candidates.reduce((worst, candidate) => (rankMostConstrained(candidate, worst) < 0 ? candidate : worst));
}

function computeDevicePressure(buffers: Buffer[], deviceId: number | null, window: L1Window): DeviceL1Pressure {
    const usableSize = window.end - window.start;
    const clippedChunks = dedupeAndClipBuffers(buffers, window.start, window.end);
    const mergedChunks = mergeOverlappingChunks(clippedChunks);
    const gapSizes = computeGapSizes(mergedChunks, window.start, window.end);
    const usedBytes = mergedChunks.reduce((sum, chunk) => sum + chunk.size, 0);
    const largestFreeBytes = gapSizes.reduce((largest, gap) => (gap > largest ? gap : largest), 0);

    return {
        deviceId,
        allocatedBytes: usedBytes,
        metrics: {
            fullnessPercent: (usedBytes / usableSize) * 100,
            freeSegments: gapSizes.length,
            largestFreeBytes,
            largestFreePercent: (largestFreeBytes / usableSize) * 100,
        },
    };
}

function dedupeAndClipBuffers(buffers: Buffer[], l1Start: number, l1End: number): MemoryChunk[] {
    const byAddress = new Map<number, number>();

    for (const buffer of buffers) {
        // A zero-size row occupies nothing, and as a zero-width chunk it would split a free gap.
        if (buffer.address != null && buffer.size > 0) {
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
