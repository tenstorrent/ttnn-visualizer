// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { expect, test } from 'vitest';
import {
    isAddressRangeOutOfL1Zoom,
    isAddressRangeVisibleInL1Zoom,
} from '../src/functions/isAddressRangeVisibleInL1Zoom';

const ZOOM: [number, number] = [0x10000, 0x15000];

test('isAddressRangeVisibleInL1Zoom detects partial overlap', () => {
    expect(isAddressRangeVisibleInL1Zoom(0x5000, 0x12000, ZOOM)).toBe(true);
});

test('isAddressRangeVisibleInL1Zoom treats leading empty below zoom as outside', () => {
    expect(isAddressRangeVisibleInL1Zoom(0, 0x10000, ZOOM)).toBe(false);
    expect(isAddressRangeOutOfL1Zoom(0, 0x10000, ZOOM)).toBe(true);
});

test('isAddressRangeVisibleInL1Zoom treats empty above zoom as outside', () => {
    expect(isAddressRangeVisibleInL1Zoom(0x20000, 0x30000, ZOOM)).toBe(false);
    expect(isAddressRangeOutOfL1Zoom(0x20000, 0x30000, ZOOM)).toBe(true);
});

test('isAddressRangeVisibleInL1Zoom does not count gap ending at zoom start as overlap', () => {
    expect(isAddressRangeVisibleInL1Zoom(0x5000, 0x10000, ZOOM)).toBe(false);
});

test('isAddressRangeVisibleInL1Zoom counts gap starting at zoom end as overlap', () => {
    expect(isAddressRangeVisibleInL1Zoom(0x15000, 0x20000, ZOOM)).toBe(true);
});

test('isAddressRangeVisibleInL1Zoom treats empty fully inside zoom as visible', () => {
    expect(isAddressRangeVisibleInL1Zoom(0x11000, 0x14000, ZOOM)).toBe(true);
    expect(isAddressRangeOutOfL1Zoom(0x11000, 0x14000, ZOOM)).toBe(false);
});

test('isAddressRangeOutOfL1Zoom returns false when zoom range is undefined', () => {
    expect(isAddressRangeOutOfL1Zoom(0, 0x10000, undefined)).toBe(false);
});

test('isAddressRangeOutOfL1Zoom treats NaN range as outside when zoom is active', () => {
    expect(isAddressRangeOutOfL1Zoom(Number.NaN, Number.NaN, ZOOM)).toBe(true);
});

test('isAddressRangeVisibleInL1Zoom treats zero-size range as outside', () => {
    expect(isAddressRangeVisibleInL1Zoom(0x11000, 0x11000, ZOOM)).toBe(false);
    expect(isAddressRangeOutOfL1Zoom(0x11000, 0x11000, ZOOM)).toBe(true);
});
