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

    describe('weight-load share (#2028)', () => {
        it('says how many of the operations are weight loads', () => {
            expect(formatBlockMeta(17, 0.14, 0, 6)).toBe('17 ops (6 weight) · 0.14 s');
        });

        it('says nothing when none of them are', () => {
            // Folding absorbs the weight loads, so the count is what explains where
            // they went. A block holding none should not raise the subject.
            expect(formatBlockMeta(17, 0.14, 0, 0)).toBe('17 ops · 0.14 s');
        });

        it('defaults to saying nothing, so callers that do not know opt out', () => {
            expect(formatBlockMeta(17, 0.14, 0)).toBe('17 ops · 0.14 s');
        });

        it('keeps the count beside the op count rather than as its own part', () => {
            // The parts are ` · `-joined; a fourth part would read as a peer of the
            // duration instead of as a breakdown of the number in front of it.
            expect(formatBlockMeta(11, 0, 0, 6).split(' · ')).toEqual(['11 ops (6 weight)']);
        });
    });
});
