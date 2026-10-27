// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it, test } from 'vitest';
import { BufferType } from '../src/model/BufferType';
import { Buffer } from '../src/model/APIData';
import { L1PressureStatus } from '../src/model/L1Pressure';
import { buildL1PressureResult, computeL1PressureForOperation } from '../src/functions/l1Pressure';
import { makeDevice } from './helpers/deviceInfo';

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

test('computeL1PressureForOperation reports the device with the smallest largest free block without device geometry', () => {
    // Device 0: two buffers leaving a fragmented layout; device 1: a single denser allocation.
    const result = computeL1PressureForOperation(
        [makeBuffer(0, 100, 0), makeBuffer(300, 100, 0), makeBuffer(0, 700, 1)],
        L1_START,
        L1_END,
    );

    // Device 1's largest gap (300) is smaller than device 0's (600), so its figures win and stay
    // internally consistent.
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
        makeDevice({
            device_id: 0,
            address_at_first_l1_cb_buffer: 103712,
            l1_bank_size: 1370848,
            worker_l1_size: 1499136,
        }),
    ];

    // Markers spanning all of L1, so ignoring either end of the device's window fails.
    const result = computeL1PressureForOperation([makeBuffer(103712, 137084, 0)], 0, 1499136, devices);

    expect(result.freeSegments).toBe(1);
    expect(result.largestFreeBytes).toBe(1370848 - 137084);
    expect(result.fullnessPercent).toBeCloseTo((137084 / 1370848) * 100, 5);
    expect(result.largestFreePercent).toBeCloseTo(((1370848 - 137084) / 1370848) * 100, 5);
});

test('computeL1PressureForOperation selects the device with the smallest largestFreeBytes even when another device has higher fullness', () => {
    const devices = [
        makeDevice({ device_id: 0, l1_bank_size: 1000, worker_l1_size: 1000 }),
        makeDevice({ device_id: 1, l1_bank_size: 1000, worker_l1_size: 1000 }),
    ];
    // Device 0: 30% full, fragmented so largestFreeBytes is 350.
    // Device 1: 60% full, contiguous so largestFreeBytes is 400.
    const buffers = [makeBuffer(0, 100, 0), makeBuffer(450, 100, 0), makeBuffer(900, 100, 0), makeBuffer(0, 600, 1)];

    const result = computeL1PressureForOperation(buffers, 0, 1000, devices);
    expect(result.largestFreeBytes).toBe(350);
    expect(result.fullnessPercent).toBeCloseTo(30, 5);
    expect(result.freeSegments).toBe(2);
});

test('computeL1PressureForOperation ignores zero-size buffers rather than splitting a free gap', () => {
    expect(computeL1PressureForOperation([makeBuffer(500, 0)], L1_START, L1_END)).toEqual({
        fullnessPercent: 0,
        freeSegments: 1,
        largestFreeBytes: 1000,
        largestFreePercent: 100,
    });
});

test('computeL1PressureForOperation falls back to the markers when no device has geometry', () => {
    const devices = [makeDevice({ device_id: 0, l1_bank_size: 0, worker_l1_size: 1000 })];

    expect(computeL1PressureForOperation([makeBuffer(0, 200)], L1_START, L1_END, devices)).toEqual({
        fullnessPercent: 20,
        freeSegments: 1,
        largestFreeBytes: 800,
        largestFreePercent: 80,
    });
});

test('computeL1PressureForOperation measures a device without geometry against the first device window', () => {
    const devices = [
        makeDevice({ device_id: 0, address_at_first_l1_cb_buffer: 100, l1_bank_size: 500, worker_l1_size: 1000 }),
    ];

    // Device 5 has no row, so it borrows device 0's [100, 600) rather than the [0, 1000) markers.
    const result = computeL1PressureForOperation([makeBuffer(100, 100, 5)], L1_START, L1_END, devices);

    expect(result.largestFreeBytes).toBe(400);
    expect(result.fullnessPercent).toBeCloseTo(20, 5);
});

describe('buildL1PressureResult with device geometry', () => {
    const ready = (l1Start: number, l1End: number) =>
        buildL1PressureResult({
            hasProfilerReport: true,
            isError: false,
            isLoading: false,
            buffersByOperation: [{ id: 7, name: 'ttnn.op', buffers: [makeBuffer(100, 100)] }],
            devices: [
                makeDevice({
                    device_id: 0,
                    address_at_first_l1_cb_buffer: 100,
                    l1_bank_size: 400,
                    worker_l1_size: 1000,
                }),
            ],
            l1SmallBuffers: [],
            l1Start,
            l1End,
        });

    it('is ready even when the markers bound nothing', () => {
        const result = ready(500, 500);

        expect(result.status).toBe(L1PressureStatus.Ready);
        expect(result.data?.get(7)?.largestFreeBytes).toBe(300);
    });

    it('measures each operation against the device window rather than the markers', () => {
        const metrics = ready(L1_START, L1_END).data?.get(7);

        // [100, 500), not [0, 1000): one 100-byte buffer leaves a 300-byte gap at 25% full.
        expect(metrics).toEqual({
            fullnessPercent: 25,
            freeSegments: 1,
            largestFreeBytes: 300,
            largestFreePercent: 75,
        });
    });
});
