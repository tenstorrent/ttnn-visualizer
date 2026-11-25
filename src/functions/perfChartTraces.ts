// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { PlotData } from 'plotly.js';
import { TypedPerfTableRow } from '../model/PerfTable';
import { getSecondaryDataColours } from '../definitions/PerformancePlotColours';
import getCoreUtilization from './getCoreUtilization';
import getPlotLabel from './getPlotLabel';
import isValidNumber from './isValidNumber';
import { getMaxFiniteValue, getMaxValue } from './numericExtent';

export interface ReportLabels {
    reportName: string | null;
    comparisonReportList: string[] | null;
}

interface SecondaryLineTraceOptions extends ReportLabels {
    valueHoverTemplate: string;
    yaxis?: PlotData['yaxis'];
}

interface SecondaryLineTraces {
    traces: Partial<PlotData>[];
    maxValue: number;
}

const hasValueAt = (values: (number | null)[], index: number) => isValidNumber(values[index]);

export const getOperationHoverTemplate = (valueHoverTemplate: string): string =>
    `<b>%{data.name}</b><br />Operation: %{x}<br />${valueHoverTemplate}<extra></extra>`;

// What every trace of a report shares, so a chart's bars and line for that report stay paired.
export const getReportTraceFields = (
    data: TypedPerfTableRow[],
    dataIndex: number,
    { reportName, comparisonReportList }: ReportLabels,
): { x: number[]; name: string | undefined; legendgroup: string } => ({
    x: data.map((_row, index) => index + 1),
    name: getPlotLabel(dataIndex, reportName, comparisonReportList),
    legendgroup: `group${dataIndex}`,
});

// Plotly's lines mode draws nothing for a value with no neighbour on either side, so those values get a
// markers-only trace; it skips hover, since the line trace already hovers on them.
export const buildLineTracesWithIsolatedMarkers = (
    line: Partial<PlotData> & { x: number[]; y: (number | null)[] },
): Partial<PlotData>[] => {
    const { x, y } = line;
    const isolated = y.flatMap((_value, index) =>
        hasValueAt(y, index) && !hasValueAt(y, index - 1) && !hasValueAt(y, index + 1) ? [index] : [],
    );

    if (isolated.length === 0) {
        return [line];
    }

    return [
        line,
        {
            x: isolated.map((index) => x[index]),
            y: isolated.map((index) => y[index]),
            mode: 'markers',
            yaxis: line.yaxis,
            legendgroup: line.legendgroup,
            showlegend: false,
            hoverinfo: 'skip',
            marker: { ...line.marker },
        },
    ];
};

export const buildSecondaryLineTraces = (
    datasets: TypedPerfTableRow[][],
    getValue: (row: TypedPerfTableRow) => number | null,
    { valueHoverTemplate, yaxis, ...reportLabels }: SecondaryLineTraceOptions,
): SecondaryLineTraces => {
    const values = datasets.map((data) => data.map(getValue));

    return {
        traces: datasets.flatMap((data, dataIndex) =>
            buildLineTracesWithIsolatedMarkers({
                ...getReportTraceFields(data, dataIndex, reportLabels),
                y: values[dataIndex],
                yaxis,
                hovertemplate: getOperationHoverTemplate(valueHoverTemplate),
                marker: {
                    color: getSecondaryDataColours(dataIndex),
                },
            }),
        ),
        maxValue: getMaxValue(values.map((datasetValues) => getMaxFiniteValue(datasetValues))),
    };
};

export const buildUtilisationTraces = (
    datasets: TypedPerfTableRow[][],
    maxCores: number,
    reportLabels: ReportLabels,
): SecondaryLineTraces =>
    buildSecondaryLineTraces(datasets, (row) => getCoreUtilization(row, maxCores), {
        valueHoverTemplate: 'Utilization: %{y}',
        yaxis: 'y2',
        ...reportLabels,
    });
