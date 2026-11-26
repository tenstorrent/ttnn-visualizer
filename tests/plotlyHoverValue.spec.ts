// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { formatPlotlyHoverY } from './helpers/plotlyHoverValue';

describe('formatPlotlyHoverY', () => {
    it("uses the trace's yhoverformat over the axis formats", () => {
        expect(formatPlotlyHoverY(108, { yhoverformat: '.1f' }, { hoverformat: 'd', tickformat: 'd' })).toBe('108.0');
    });

    it('uses the axis hoverformat over its tickformat', () => {
        expect(formatPlotlyHoverY(108, {}, { hoverformat: ',.2r', tickformat: 'd' })).toBe('110');
    });

    it('falls back to the axis tickformat', () => {
        expect(formatPlotlyHoverY(1234, {}, { tickformat: ',d' })).toBe('1,234');
    });

    it('throws when no format is set, since Plotly would use its automatic number format', () => {
        expect(() => formatPlotlyHoverY(1, {}, undefined)).toThrow();
        expect(() => formatPlotlyHoverY(1, {}, {})).toThrow();
    });
});
