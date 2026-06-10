// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { getCoresInRange, getCoresInRangeList } from '../src/functions/math';

describe('getCoresInRangeList', () => {
    describe('legacy (x=N,y=N) format', () => {
        it('returns a single core for a degenerate rectangle', () => {
            expect(getCoresInRangeList('{[(x=0,y=0) - (x=0,y=0)]}')).toEqual([{ x: 0, y: 0 }]);
        });

        it('expands a column rectangle inclusively', () => {
            const cores = getCoresInRangeList('{[(x=0,y=0) - (x=0,y=7)]}');
            expect(cores).toHaveLength(8);
            expect(cores).toContainEqual({ x: 0, y: 0 });
            expect(cores).toContainEqual({ x: 0, y: 7 });
        });

        it('expands a full 8x8 grid to 64 cores', () => {
            expect(getCoresInRangeList('{[(x=0,y=0) - (x=7,y=7)]}')).toHaveLength(64);
        });

        it('handles a non-origin single core', () => {
            expect(getCoresInRangeList('{[(x=6,y=7) - (x=6,y=7)]}')).toEqual([{ x: 6, y: 7 }]);
        });
    });

    describe('legacy multi-rectangle unions', () => {
        it('dedupes the union of disjoint rectangles', () => {
            const cores = getCoresInRangeList('{[(x=0,y=0) - (x=1,y=3)], [(x=0,y=4) - (x=0,y=7)]}');
            expect(cores).toHaveLength(12);
            expect(cores).toContainEqual({ x: 0, y: 4 });
            expect(cores).toContainEqual({ x: 1, y: 3 });
        });

        it('handles the full-row + tail union pattern from real reports', () => {
            const cores = getCoresInRangeList('{[(x=0,y=0) - (x=7,y=6)], [(x=0,y=7) - (x=5,y=7)]}');
            expect(cores).toHaveLength(7 * 8 + 6);
        });

        it('does not double-count overlapping rectangles', () => {
            const cores = getCoresInRangeList('{[(x=0,y=0) - (x=2,y=2)], [(x=1,y=1) - (x=3,y=3)]}');
            const keys = new Set(cores.map(({ x, y }) => `${x},${y}`));
            expect(keys.size).toBe(cores.length);
            // 3x3 + 3x3 - 2x2 overlap = 14 unique cores
            expect(cores).toHaveLength(14);
        });
    });

    describe('modern N-N format', () => {
        it('parses a single-core modern range', () => {
            expect(getCoresInRangeList('{[0-0 - 0-0]}')).toEqual([{ x: 0, y: 0 }]);
        });

        it('parses a non-origin single-core modern range', () => {
            expect(getCoresInRangeList('{[1-0 - 1-0]}')).toEqual([{ x: 1, y: 0 }]);
        });

        it('expands a multi-cell modern rectangle inclusively', () => {
            const cores = getCoresInRangeList('{[2-0 - 5-7]}');
            expect(cores).toHaveLength(4 * 8);
            expect(cores).toContainEqual({ x: 2, y: 0 });
            expect(cores).toContainEqual({ x: 5, y: 7 });
        });

        it('handles multi-digit coordinates without splitting digits', () => {
            const cores = getCoresInRangeList('{[10-2 - 12-2]}');
            expect(cores).toEqual([
                { x: 10, y: 2 },
                { x: 11, y: 2 },
                { x: 12, y: 2 },
            ]);
        });
    });

    describe('empty and malformed input', () => {
        it('returns an empty list for {}', () => {
            expect(getCoresInRangeList('{}')).toEqual([]);
        });

        it('returns an empty list for a rectangle with only one corner', () => {
            expect(getCoresInRangeList('{[(x=0,y=0)]}')).toEqual([]);
        });

        it('returns an empty list for a non-matching string', () => {
            expect(getCoresInRangeList('garbage')).toEqual([]);
        });
    });
});

describe('getCoresInRange', () => {
    it('returns the number of cores covered by the union', () => {
        expect(getCoresInRange('{[(x=0,y=0) - (x=0,y=0)]}')).toBe(1);
        expect(getCoresInRange('{[(x=0,y=0) - (x=7,y=7)]}')).toBe(64);
        expect(getCoresInRange('{[(x=0,y=0) - (x=1,y=3)], [(x=0,y=4) - (x=0,y=7)]}')).toBe(12);
        expect(getCoresInRange('{[0-0 - 0-0]}')).toBe(1);
        expect(getCoresInRange('{}')).toBe(0);
    });
});
