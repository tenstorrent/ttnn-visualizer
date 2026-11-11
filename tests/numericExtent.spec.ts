// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * `Math.min(...rows)` throws `RangeError` once a report passes the engine's argument limit (around
 * 120k rows in V8), and the footer computed the performance range that way on every route, so a
 * large report replaced the whole app with the error page. These helpers fold instead; the cases
 * pin both the scale and that they keep the spread's semantics at the edges.
 */

import { describe, expect, it } from 'vitest';
import { getMaxValue, getMinValue, getPerformanceIdRange } from '../src/functions/numericExtent';
import { PerfTableRow } from '../src/model/PerfTable';

const LARGE_REPORT_ROWS = 200_000;

// Ids in a fixed scrambled order, so the extremes are neither first nor last
const scrambledIds = (count: number): number[] => {
    const ids = Array.from({ length: count }, (_, index) => index + 1);
    const stride = 7_919; // Prime, so stepping by it visits every index once

    return ids.map((_, index) => ids[(index * stride) % count]);
};

describe('getPerformanceIdRange', () => {
    it('spans a report too large for a spread', () => {
        const report = scrambledIds(LARGE_REPORT_ROWS).map((id) => ({ id: String(id) }) as PerfTableRow);

        expect(() => Math.min(...report.map((row) => parseInt(row.id, 10)))).toThrow(RangeError);
        expect(getPerformanceIdRange(report)).toEqual([1, LARGE_REPORT_ROWS]);
    });

    it('is null for a missing or empty report', () => {
        expect(getPerformanceIdRange(undefined)).toBeNull();
        expect(getPerformanceIdRange([])).toBeNull();
    });
});

describe('getMaxValue and getMinValue', () => {
    it('reduce input too large for a spread', () => {
        const values = scrambledIds(LARGE_REPORT_ROWS);

        expect(getMaxValue(values)).toBe(LARGE_REPORT_ROWS);
        expect(getMinValue(values)).toBe(1);
    });

    it('match the spread on empty input, NaN and null', () => {
        expect(getMaxValue([])).toBe(Math.max());
        expect(getMinValue([])).toBe(Math.min());
        expect(getMaxValue([1, NaN, 3])).toBeNaN();
        expect(getMinValue([1, NaN, 3])).toBeNaN();

        const withNull = [-2, null as unknown as number];

        expect(getMaxValue(withNull)).toBe(Math.max(...withNull));
    });
});
