// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { resolvePerfTablePrefilter } from '../src/functions/resolvePerfTablePrefilter';

describe('resolvePerfTablePrefilter', () => {
    it('replaces the selection and navigates on a plain click', () => {
        expect(resolvePerfTablePrefilter([1, 100], 10)).toEqual({ selection: [10], shouldShowPerfTable: true });
    });

    it('adds without navigating when the gesture is additive', () => {
        expect(resolvePerfTablePrefilter([1], 10, { additive: true })).toEqual({
            selection: [1, 10],
            shouldShowPerfTable: false,
        });
    });

    it('removes without navigating when the additive gesture lands on a selected value', () => {
        expect(resolvePerfTablePrefilter([1, 10], 10, { additive: true })).toEqual({
            selection: [1],
            shouldShowPerfTable: false,
        });
    });

    it('clears when a plain click lands on the only value the caller drew as selected', () => {
        expect(resolvePerfTablePrefilter([10], 10, { visibleValues: [1, 10] })).toEqual({
            selection: [],
            shouldShowPerfTable: false,
        });
    });

    it('judges the sole selection against the drawn values, not the whole filter', () => {
        // 1000 is selected but undrawn, so 10 is still the only selected control on screen.
        expect(resolvePerfTablePrefilter([10, 1000], 10, { visibleValues: [1, 10] })).toEqual({
            selection: [1000],
            shouldShowPerfTable: false,
        });
    });

    it('replaces when another drawn value is selected alongside the clicked one', () => {
        expect(resolvePerfTablePrefilter([1, 10], 10, { visibleValues: [1, 10] })).toEqual({
            selection: [10],
            shouldShowPerfTable: true,
        });
    });

    it('withholds click-again-to-clear from callers that do not say what they drew', () => {
        // Without a declared scope there is no control whose selected state the user clicked off.
        expect(resolvePerfTablePrefilter(['Matmul'], 'Matmul')).toEqual({
            selection: ['Matmul'],
            shouldShowPerfTable: true,
        });
    });
});
