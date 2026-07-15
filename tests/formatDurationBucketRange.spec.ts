// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { formatDurationBucketRange } from '../src/functions/formatDurationBucketRange';

describe('formatDurationBucketRange', () => {
    it('formats sub-microsecond open lower bound', () => {
        expect(formatDurationBucketRange(0, 1)).toBe('< 1 µs');
    });

    it('formats a microsecond range', () => {
        expect(formatDurationBucketRange(1, 10)).toBe('1 µs – 10 µs');
    });
});
