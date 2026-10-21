// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { expect, test } from 'vitest';
import { BufferType } from '../src/model/BufferType';
import { Buffer } from '../src/model/APIData';
import { L1PressureStatus } from '../src/model/L1Pressure';
import { buildL1PressureResult, computeL1PressureForOperation } from '../src/functions/l1Pressure';

const L1_START = 0;
const L1_END = 1000;

const makeBuffer = (address: number, size: number, deviceId = 0): Buffer => ({
    address,
    size,
    buffer_type: BufferType.L1,
    device_id: deviceId,
});

test('computeL1PressureForOperation returns fully free L1 when no buffers are allocated', () => {
    expect(computeL1PressureForOperation([], L1_START, L1_END)).toEqual({
        fullnessPercent: 0,
        freeSegments: 1,
        largestFreeBytes: 1000,
        largestFreePercent: 100,
    });
});

test('computeL1PressureForOperation handles a single buffer flush at l1Start', () => {
    expect(computeL1PressureForOperation([makeBuffer(0, 200)], L1_START, L1_END)).toEqual({
        fullnessPercent: 20,
        freeSegments: 1,
        largestFreeBytes: 800,
        largestFreePercent: 80,
    });
});

test('computeL1PressureForOperation counts a gap between two buffers', () => {
    expect(computeL1PressureForOperation([makeBuffer(0, 100), makeBuffer(300, 100)], L1_START, L1_END)).toEqual({
        fullnessPercent: 20,
        freeSegments: 2,
        largestFreeBytes: 600,
        largestFreePercent: 60,
    });
});

test('computeL1PressureForOperation dedupes overlapping buffers by address keeping the largest size', () => {
    expect(
        computeL1PressureForOperation(
            [makeBuffer(100, 100), makeBuffer(100, 300), makeBuffer(500, 100)],
            L1_START,
            L1_END,
        ),
    ).toEqual({
        fullnessPercent: 40,
        freeSegments: 3,
        largestFreeBytes: 400,
        largestFreePercent: 40,
    });
});

test('computeL1PressureForOperation merges overlapping address ranges', () => {
    expect(computeL1PressureForOperation([makeBuffer(0, 300), makeBuffer(200, 200)], L1_START, L1_END)).toEqual({
        fullnessPercent: 40,
        freeSegments: 1,
        largestFreeBytes: 600,
        largestFreePercent: 60,
    });
});

test('computeL1PressureForOperation reports no free segments when L1 is fully packed', () => {
    expect(computeL1PressureForOperation([makeBuffer(0, 1000)], L1_START, L1_END)).toEqual({
        fullnessPercent: 100,
        freeSegments: 0,
        largestFreeBytes: 0,
        largestFreePercent: 0,
    });
});

test('computeL1PressureForOperation omits trailing gap when the last buffer ends at l1End', () => {
    expect(computeL1PressureForOperation([makeBuffer(0, 100), makeBuffer(900, 100)], L1_START, L1_END)).toEqual({
        fullnessPercent: 20,
        freeSegments: 1,
        largestFreeBytes: 800,
        largestFreePercent: 80,
    });
});

test('computeL1PressureForOperation clips buffers outside the usable L1 window', () => {
    expect(computeL1PressureForOperation([makeBuffer(-100, 200), makeBuffer(950, 200)], L1_START, L1_END)).toEqual({
        fullnessPercent: 15,
        freeSegments: 1,
        largestFreeBytes: 850,
        largestFreePercent: 85,
    });
});

test('computeL1PressureForOperation returns zeros when the usable L1 window is invalid', () => {
    expect(computeL1PressureForOperation([makeBuffer(0, 100)], 500, 500)).toEqual({
        fullnessPercent: 0,
        freeSegments: 0,
        largestFreeBytes: 0,
        largestFreePercent: 0,
    });
});

test('computeL1PressureForOperation does not merge same-offset buffers across devices', () => {
    // Both devices allocate at address 0; treating them as one address space would dedupe to a
    // single 200-byte chunk. Grouping by device keeps device 1's 400-byte allocation distinct.
    const result = computeL1PressureForOperation([makeBuffer(0, 200, 0), makeBuffer(0, 400, 1)], L1_START, L1_END);

    // Worst-case device is device 1 (400/1000 = 40% full), not the merged 20%.
    expect(result).toEqual({
        fullnessPercent: 40,
        freeSegments: 1,
        largestFreeBytes: 600,
        largestFreePercent: 60,
    });
});

test('computeL1PressureForOperation reports the most-full device across devices', () => {
    // Device 0: two buffers leaving a fragmented layout; device 1: a single denser allocation.
    const result = computeL1PressureForOperation(
        [makeBuffer(0, 100, 0), makeBuffer(300, 100, 0), makeBuffer(0, 700, 1)],
        L1_START,
        L1_END,
    );

    // Device 1 is fuller (70% vs 20%), so its figures win and stay internally consistent.
    expect(result).toEqual({
        fullnessPercent: 70,
        freeSegments: 1,
        largestFreeBytes: 300,
        largestFreePercent: 30,
    });
});

test('buildL1PressureResult returns unavailable when no memory profiler report is linked', () => {
    expect(
        buildL1PressureResult({
            hasProfilerReport: false,
            isError: false,
            isLoading: false,
            buffersByOperation: undefined,
            devices: undefined,
            l1SmallBuffers: undefined,
            l1Start: L1_START,
            l1End: L1_END,
        }),
    ).toEqual({ status: L1PressureStatus.Unavailable, data: null });
});

test('buildL1PressureResult returns unavailable when the buffer query is idle with no data', () => {
    expect(
        buildL1PressureResult({
            hasProfilerReport: true,
            isError: false,
            isLoading: false,
            buffersByOperation: undefined,
            devices: [],
            l1SmallBuffers: [],
            l1Start: L1_START,
            l1End: L1_END,
        }),
    ).toEqual({ status: L1PressureStatus.Unavailable, data: null });
});

test('buildL1PressureResult returns loading while inputs are still fetching', () => {
    expect(
        buildL1PressureResult({
            hasProfilerReport: true,
            isError: false,
            isLoading: true,
            buffersByOperation: undefined,
            devices: undefined,
            l1SmallBuffers: undefined,
            l1Start: L1_START,
            l1End: L1_END,
        }),
    ).toEqual({ status: L1PressureStatus.Loading, data: null });
});

test('computeL1PressureForOperation bounds each device by address_at_first_l1_cb_buffer and l1_bank_size when devices are provided', () => {
    const devices = [
        {
            device_id: 0,
            address_at_first_l1_bank: 103712,
            address_at_first_l1_cb_buffer: 103712,
            l1_bank_size: 1370848,
            worker_l1_size: 1499136,
            l1_num_banks: 64,
            num_banks_per_storage_core: 1,
            num_compute_cores: 64,
            num_x_compute_cores: 8,
            num_x_cores: 8,
            num_y_compute_cores: 8,
            num_y_cores: 8,
            total_l1_for_interleaved_buffers: 0,
            total_l1_for_sharded_buffers: 0,
            total_l1_for_tensors: 0,
            total_l1_memory: 0,
            cb_limit: 0,
        },
    ];

    const result = computeL1PressureForOperation([makeBuffer(103712, 137084, 0)], 103712, 1499136, devices);

    expect(result.freeSegments).toBe(1);
    expect(result.largestFreeBytes).toBe(1370848 - 137084);
    expect(result.fullnessPercent).toBeCloseTo(10, 5);
    expect(result.largestFreePercent).toBeCloseTo(90, 5);
});
