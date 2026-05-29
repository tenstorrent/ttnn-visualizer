// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { expect, test } from 'vitest';
import { BufferType } from '../src/model/BufferType';
import { Buffer } from '../src/model/APIData';
import { computeL1PressureForOperation } from '../src/functions/l1Pressure';

const L1_START = 0;
const L1_END = 1000;

const makeBuffer = (address: number, size: number): Buffer => ({
    address,
    size,
    buffer_type: BufferType.L1,
    device_id: 0,
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
