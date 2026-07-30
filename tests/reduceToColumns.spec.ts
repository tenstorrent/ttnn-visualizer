// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import reduceToColumns from '../src/functions/reduceToColumns';

describe('reduceToColumns', () => {
    it('takes the max of each column’s range, wherever the peak sits', () => {
        // Peak first, peak middle, peak last — a last-wins or first-wins reduction
        // fails at least one of these.
        expect(reduceToColumns([9, 1, 1, 1, 1, 1], 2)).toEqual([9, 1]);
        expect(reduceToColumns([1, 9, 1, 1, 1, 1], 2)).toEqual([9, 1]);
        expect(reduceToColumns([1, 1, 9, 1, 1, 1], 2)).toEqual([9, 1]);
        expect(reduceToColumns([1, 1, 1, 1, 1, 9], 2)).toEqual([1, 9]);
    });

    it('partitions the series with no gap, overlap or dropped step', () => {
        // Every input value must land in exactly one column, so summing the maxima
        // of a strictly-increasing series per column is a full-coverage check.
        const values = [0, 1, 2, 3, 4, 5, 6, 7];
        expect(reduceToColumns(values, 4)).toEqual([1, 3, 5, 7]);
        expect(reduceToColumns(values, 8)).toEqual(values);
    });

    it('emits one column per step when asked for more columns than steps', () => {
        // Callers clamp columnCount to the data size; if one doesn't, no column may
        // come out empty.
        expect(reduceToColumns([5, 7], 5)).toEqual([5, 5, 5, 7, 7]);
    });

    it('ignores undefined values but keeps a column undefined when it has none', () => {
        expect(reduceToColumns([undefined, 4, 2, undefined], 2)).toEqual([4, 2]);
        expect(reduceToColumns([undefined, undefined, 3, 3], 2)).toEqual([undefined, 3]);
    });

    it('preserves negative sentinels rather than treating them as absent', () => {
        // -1 means "no data" for max-link-demand and must reach the palette as -1.
        expect(reduceToColumns([-1, -1, -1, 5], 2)).toEqual([-1, 5]);
    });

    it('returns nothing for an empty series or a non-positive column count', () => {
        expect(reduceToColumns([], 10)).toEqual([]);
        expect(reduceToColumns([1, 2], 0)).toEqual([]);
        expect(reduceToColumns([1, 2], -1)).toEqual([]);
    });
});
