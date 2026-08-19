// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Op<->perf ids are resolved against the link-pinned report while the slider
 * spans the rows the performance tab is displaying, so a mapped id can land
 * outside the track (#1812). These cases pin both halves of the response: clamp
 * when the selection still overlaps, widen when it misses entirely.
 */

import { describe, expect, it } from 'vitest';
import { clampSelectionToRange } from '../src/functions/perfRangeSelection';

const RANGE_MIN = 100;
const RANGE_MAX = 200;

describe('clampSelectionToRange', () => {
    it('leaves a selection already inside the track untouched', () => {
        expect(clampSelectionToRange(120, 180, RANGE_MIN, RANGE_MAX)).toEqual([120, 180]);
    });

    it('clamps a selection that overhangs the low edge', () => {
        expect(clampSelectionToRange(40, 180, RANGE_MIN, RANGE_MAX)).toEqual([RANGE_MIN, 180]);
    });

    it('clamps a selection that overhangs the high edge', () => {
        expect(clampSelectionToRange(120, 900, RANGE_MIN, RANGE_MAX)).toEqual([120, RANGE_MAX]);
    });

    it('clamps a selection that overhangs both edges', () => {
        expect(clampSelectionToRange(40, 900, RANGE_MIN, RANGE_MAX)).toEqual([RANGE_MIN, RANGE_MAX]);
    });

    // Clamping here would give [100, 100], which `Performance.tsx` renders as a
    // single row rather than falling back to the whole report.
    it('widens to the whole track when the selection sits entirely below it', () => {
        expect(clampSelectionToRange(5, 9, RANGE_MIN, RANGE_MAX)).toEqual([RANGE_MIN, RANGE_MAX]);
    });

    it('widens to the whole track when the selection sits entirely above it', () => {
        expect(clampSelectionToRange(500, 900, RANGE_MIN, RANGE_MAX)).toEqual([RANGE_MIN, RANGE_MAX]);
    });

    it('treats a selection touching an edge as overlapping, not missing', () => {
        expect(clampSelectionToRange(5, RANGE_MIN, RANGE_MIN, RANGE_MAX)).toEqual([RANGE_MIN, RANGE_MIN]);
        expect(clampSelectionToRange(RANGE_MAX, 900, RANGE_MIN, RANGE_MAX)).toEqual([RANGE_MAX, RANGE_MAX]);
    });

    it('holds a single-value track still', () => {
        expect(clampSelectionToRange(5, 900, RANGE_MIN, RANGE_MIN)).toEqual([RANGE_MIN, RANGE_MIN]);
    });
});
