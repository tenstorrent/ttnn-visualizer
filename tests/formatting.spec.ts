// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

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
        expect(formatDuration(1_500_000)).toBe('1.50 ms');
    });

    it('formats seconds as s', () => {
        expect(formatDuration(1_500_000_000)).toBe('1.50 s');
    });

    it('returns "0 ns" for zero, negative, and non-finite input', () => {
        expect(formatDuration(0)).toBe('0 ns');
        expect(formatDuration(-1)).toBe('0 ns');
        expect(formatDuration(Number.NaN)).toBe('0 ns');
        expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0 ns');
    });
});
