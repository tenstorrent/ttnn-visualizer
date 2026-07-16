// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { PlotMouseEvent } from 'plotly.js';
import { getRawOpCodeFromPlotClick } from '../src/functions/getRawOpCodeFromPlotClick';

const clickEvent = (point: Record<string, unknown>): PlotMouseEvent =>
    ({
        points: [point],
    }) as unknown as PlotMouseEvent;

describe('getRawOpCodeFromPlotClick', () => {
    it('reads a flat customdata string', () => {
        expect(getRawOpCodeFromPlotClick(clickEvent({ customdata: 'Matmul' }))).toBe('Matmul');
    });

    it('reads raw op code from tuple customdata used by the duration histogram', () => {
        expect(getRawOpCodeFromPlotClick(clickEvent({ customdata: ['OptimizedConvNew', 3, 'a, b'] }))).toBe(
            'OptimizedConvNew',
        );
    });

    it('returns null for empty or non-string tuple customdata heads', () => {
        expect(getRawOpCodeFromPlotClick(clickEvent({ customdata: [''] }))).toBeNull();
        expect(getRawOpCodeFromPlotClick(clickEvent({ customdata: [42] }))).toBeNull();
    });

    it('does not fall back to label when customdata is absent', () => {
        expect(getRawOpCodeFromPlotClick(clickEvent({ label: 'Conv2d' }))).toBeNull();
    });

    it('returns null when points are missing', () => {
        expect(getRawOpCodeFromPlotClick({ points: [] } as unknown as PlotMouseEvent)).toBeNull();
    });

    it('returns null for empty strings', () => {
        expect(getRawOpCodeFromPlotClick(clickEvent({ customdata: '' }))).toBeNull();
    });
});
