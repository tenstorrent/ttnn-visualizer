// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { formatBlockMeta } from '../src/components/operation-graph/opGraphBlockMeta';

describe('formatBlockMeta', () => {
    it('omits duration and memory when they are zero', () => {
        expect(formatBlockMeta(3, 0, 0)).toBe('3 ops');
    });

    it('includes a signed memory delta when it is not zero', () => {
        expect(formatBlockMeta(2, 1.5, 1024)).toContain('+');
        expect(formatBlockMeta(2, 1.5, -1024)).toContain('-');
    });
});
