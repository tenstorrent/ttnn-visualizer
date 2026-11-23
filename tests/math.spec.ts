// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { MAX_PERCENT, clampPercent, nsToUs, sumOptional, tensorBytes } from '../src/functions/math';

describe('nsToUs', () => {
    it('converts a nanosecond string to microseconds', () => {
        expect(nsToUs('1500')).toBe(1.5);
        expect(nsToUs('1000')).toBe(1);
        expect(nsToUs('250')).toBe(0.25);
    });

    it('preserves a genuine zero duration', () => {
        expect(nsToUs('0')).toBe(0);
    });

    it('returns null when the value is absent', () => {
        expect(nsToUs('')).toBeNull();
        expect(nsToUs(null)).toBeNull();
        expect(nsToUs(undefined)).toBeNull();
    });

    it('returns null for non-numeric input instead of propagating NaN', () => {
        expect(nsToUs('   ')).toBeNull();
        expect(nsToUs('n/a')).toBeNull();
    });
});

describe('sumOptional', () => {
    it('adds finite numbers and skips the rest', () => {
        expect(sumOptional([1, undefined, 2.5, Number.NaN, Number.POSITIVE_INFINITY])).toBe(3.5);
        expect(sumOptional([])).toBe(0);
    });
});

describe('clampPercent', () => {
    it('holds a percentage to 0–100 for a bar', () => {
        expect(clampPercent(42.5)).toBe(42.5);
        expect(clampPercent(-3)).toBe(0);
        expect(clampPercent(104)).toBe(MAX_PERCENT);
    });

    it('reads a value that is not a finite number as 0', () => {
        expect(clampPercent(Number.NaN)).toBe(0);
        expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(0);
    });
});

describe('tensorBytes', () => {
    it('totals tensor sizes and counts an unknown size as zero', () => {
        expect(tensorBytes([{ size: 512 }, { size: null }, { size: 1536 }])).toBe(2048);
        expect(tensorBytes([])).toBe(0);
    });
});
