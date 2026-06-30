// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { nsToUs } from '../src/functions/math';

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
