// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { expect, test } from 'vitest';
import isValidNumber from '../src/functions/isValidNumber';

test('isValidNumber returns true for valid numbers', () => {
    expect(isValidNumber(123)).toBe(true);
    expect(isValidNumber(0)).toBe(true);
    expect(isValidNumber(-456)).toBe(true);
    expect(isValidNumber(3.14)).toBe(true);
});

test('isValidNumber returns false for invalid numbers', () => {
    expect(isValidNumber(NaN)).toBe(false);
    expect(isValidNumber(Infinity)).toBe(false);
    expect(isValidNumber(-Infinity)).toBe(false);
});

test('isValidNumber returns false for non-number inputs', () => {
    expect(isValidNumber('123')).toBe(false);
    expect(isValidNumber(null)).toBe(false);
    expect(isValidNumber(undefined)).toBe(false);
    expect(isValidNumber({})).toBe(false);
    expect(isValidNumber([])).toBe(false);
});
