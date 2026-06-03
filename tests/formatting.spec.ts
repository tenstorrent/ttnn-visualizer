// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { formatDuration } from '../src/functions/formatting';

describe('formatDuration', () => {
    it('formats sub-microsecond as ns', () => {
        expect(formatDuration(500)).toBe('500 ns');
    });

    it('formats sub-millisecond as µs', () => {
        expect(formatDuration(1_500)).toBe('1.5 µs');
    });

    it('formats sub-second as ms', () => {
        // `formatSize` uses `maximumFractionDigits` only, so trailing zeros
        // are trimmed (1.5 → "1.5", 1.23 → "1.23"). That's an intentional
        // shift from the previous `toFixed(2)` behaviour.
        expect(formatDuration(1_500_000)).toBe('1.5 ms');
        expect(formatDuration(1_234_500)).toBe('1.23 ms');
    });

    it('formats seconds as s', () => {
        expect(formatDuration(1_500_000_000)).toBe('1.5 s');
        expect(formatDuration(1_234_500_000)).toBe('1.23 s');
    });

    it('returns "0 ns" for zero, negative, and non-finite input', () => {
        expect(formatDuration(0)).toBe('0 ns');
        expect(formatDuration(-1)).toBe('0 ns');
        expect(formatDuration(Number.NaN)).toBe('0 ns');
        expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0 ns');
    });
});
