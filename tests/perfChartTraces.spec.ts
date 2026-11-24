// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { buildLineTracesWithIsolatedMarkers } from '../src/functions/perfChartTraces';

describe('buildLineTracesWithIsolatedMarkers', () => {
    const line = (y: (number | null)[]) => ({
        x: y.map((_value, index) => index + 1),
        y,
        yaxis: 'y2',
        legendgroup: 'group0',
        marker: { color: 'red' },
    });

    it.each<[string, (number | null)[]]>([
        ['no gaps', [1, 2, 3]],
        ['runs of two or more values between the gaps', [1, 2, null, 3, 4]],
        ['no values at all', [null, null]],
    ])('returns the line alone with %s', (_, y) => {
        const trace = line(y);

        expect(buildLineTracesWithIsolatedMarkers(trace)).toEqual([trace]);
    });

    it('marks each value with no neighbour, at either end too', () => {
        const [, markers] = buildLineTracesWithIsolatedMarkers(line([5, null, 6, null, null, 7]));

        expect(markers).toMatchObject({ x: [1, 3, 6], y: [5, 6, 7], mode: 'markers' });
    });

    it('reads NaN as a gap, as Plotly does', () => {
        const [, markers] = buildLineTracesWithIsolatedMarkers(line([NaN, 4, NaN]));

        expect(markers).toMatchObject({ x: [2], y: [4] });
    });

    it("keeps the markers in the line's axis, legend group and colour, with no legend entry or hover", () => {
        const [, markers] = buildLineTracesWithIsolatedMarkers(line([null, 4, null]));

        expect(markers).toEqual({
            x: [2],
            y: [4],
            mode: 'markers',
            yaxis: 'y2',
            legendgroup: 'group0',
            showlegend: false,
            hoverinfo: 'skip',
            marker: { color: 'red' },
        });
    });
});
