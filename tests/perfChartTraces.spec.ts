// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { getSecondaryDataColours } from '../src/definitions/PerformancePlotColours';
import {
    buildLineTracesWithIsolatedMarkers,
    buildSecondaryLineTraces,
    buildUtilisationTraces,
    getReportTraceFields,
} from '../src/functions/perfChartTraces';
import { TypedPerfTableRow } from '../src/model/PerfTable';

const BASE_ONLY = { reportName: 'Base', comparisonReportList: null };

describe('getReportTraceFields', () => {
    const rows = [{}, {}, {}] as TypedPerfTableRow[];

    it.each<[number, string]>([
        [0, 'Base'],
        [1, 'Other'],
    ])("numbers the ops from 1, and names and groups report %i's traces after it", (dataIndex, name) => {
        expect(getReportTraceFields(rows, dataIndex, { reportName: 'Base', comparisonReportList: ['Other'] })).toEqual({
            x: [1, 2, 3],
            name,
            legendgroup: `group${dataIndex}`,
        });
    });
});

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
        ['a single gap and nothing else', [null]],
    ])('returns the line alone with %s', (_, y) => {
        const trace = line(y);

        expect(buildLineTracesWithIsolatedMarkers(trace)).toEqual([trace]);
    });

    it('marks each value with no neighbour, at either end too', () => {
        const [, markers] = buildLineTracesWithIsolatedMarkers(line([5, null, 6, null, null, 7]));

        expect(markers).toMatchObject({ x: [1, 3, 6], y: [5, 6, 7], mode: 'markers' });
    });

    it('marks the only value of a one-value series', () => {
        const [, markers] = buildLineTracesWithIsolatedMarkers(line([5]));

        expect(markers).toMatchObject({ x: [1], y: [5], mode: 'markers' });
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

describe('buildSecondaryLineTraces', () => {
    const rows = (values: (number | null)[]) =>
        values.map((value) => ({ pm_ideal_ns: value }) as unknown as TypedPerfTableRow);
    const getIdealTime = (row: TypedPerfTableRow) => row.pm_ideal_ns;
    const OPTIONS = { valueHoverTemplate: 'Ideal time: %{y} ns', yaxis: 'y2', ...BASE_ONLY };

    it('builds a line per report, named, grouped and coloured after its report', () => {
        const { traces } = buildSecondaryLineTraces([rows([1, 2]), rows([3, 4, 5])], getIdealTime, {
            ...OPTIONS,
            comparisonReportList: ['Other'],
        });

        expect(traces).toEqual(
            [
                { name: 'Base', x: [1, 2], y: [1, 2] },
                { name: 'Other', x: [1, 2, 3], y: [3, 4, 5] },
            ].map((expected, dataIndex) => ({
                ...expected,
                yaxis: 'y2',
                hovertemplate: '<b>%{data.name}</b><br />Operation: %{x}<br />Ideal time: %{y} ns<extra></extra>',
                legendgroup: `group${dataIndex}`,
                marker: { color: getSecondaryDataColours(dataIndex) },
            })),
        );
    });

    it('gives the largest known value across every report', () => {
        const { maxValue } = buildSecondaryLineTraces([rows([2, null]), rows([null, 7, 3])], getIdealTime, OPTIONS);

        expect(maxValue).toBe(7);
    });

    it.each<[string, TypedPerfTableRow[][]]>([
        ['no value is known', [rows([null, null])]],
        ['there are no reports', []],
    ])('gives -Infinity when %s', (_, datasets) => {
        expect(buildSecondaryLineTraces(datasets, getIdealTime, OPTIONS).maxValue).toBe(-Infinity);
    });

    it('leaves the line and its markers on the default axis when none is given', () => {
        const { traces } = buildSecondaryLineTraces([rows([null, 4, null])], getIdealTime, {
            valueHoverTemplate: 'Ideal time: %{y} ns',
            ...BASE_ONLY,
        });

        expect(traces).toHaveLength(2);
        expect(traces.map((trace) => trace.yaxis)).toEqual([undefined, undefined]);
    });
});

describe('buildUtilisationTraces', () => {
    it("plots each row's core utilisation against maxCores, on the second axis", () => {
        // 5 µs of a 10 µs op on 64 cores, with 128 available.
        const row = { pm_ideal_ns: 5_000, device_time: 10, cores: 64, available_cores: null } as TypedPerfTableRow;

        expect(buildUtilisationTraces([[row, row]], 128, BASE_ONLY)).toMatchObject({
            traces: [
                {
                    y: [1, 1],
                    yaxis: 'y2',
                    hovertemplate: '<b>%{data.name}</b><br />Operation: %{x}<br />Utilization: %{y}<extra></extra>',
                },
            ],
            maxValue: 1,
        });
    });
});
