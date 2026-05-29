// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Annotations, PlotData, Shape } from 'plotly.js';
import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { TypedPerfTableRow } from '../../definitions/PerfTable';
import PerfChart from './PerfChart';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';
import getPlotLabel from '../../functions/getPlotLabel';
import { activePerformanceReportAtom, comparisonPerformanceReportListAtom } from '../../store/app';
import { getPrimaryDataColours, getSecondaryDataColours } from '../../definitions/PerformancePlotColours';
import { buildL1PressureChartSeries } from '../../functions/buildL1PressureChartSeries';
import {
    L1_FULLNESS_CRITICAL_PERCENT,
    L1_FULLNESS_WARNING_PERCENT,
    L1_LARGEST_FREE_CRITICAL_PERCENT,
    L1_LARGEST_FREE_WARNING_PERCENT,
} from '../../definitions/L1Pressure';
import { GRAPH_COLORS } from '../../definitions/GraphColors';

interface PerfL1PressureChartProps {
    datasets?: TypedPerfTableRow[][];
}

interface ThresholdLine {
    y: number;
    yref: 'y' | 'y2';
    label: string;
    colour: string;
}

function PerfL1PressureChart({ datasets = [] }: PerfL1PressureChartProps) {
    const perfReport = useAtomValue(activePerformanceReportAtom);
    const comparisonReportList = useAtomValue(comparisonPerformanceReportListAtom);
    const maxDataSize = datasets.reduce((max, data) => Math.max(max, data?.length || 0), 0);

    const fullnessTraces = useMemo(
        () =>
            datasets.map((data, dataIndex) => {
                const series = buildL1PressureChartSeries(data);
                const label = getPlotLabel(dataIndex, perfReport?.reportName, comparisonReportList);

                return {
                    x: series.x,
                    y: series.fullnessPercent,
                    customdata: series.opCodes,
                    type: 'scatter',
                    mode: 'lines',
                    connectgaps: true,
                    name: `${label} — L1 fullness`,
                    legendgroup: `group${dataIndex}`,
                    showlegend: true,
                    line: {
                        color: getPrimaryDataColours(dataIndex),
                        width: 1.5,
                    },
                    hovertemplate:
                        '<b>%{fullData.name}</b><br />Op %{x}: %{customdata}<br />L1 fullness: %{y:.1f}%<extra></extra>',
                } as Partial<PlotData>;
            }),
        [comparisonReportList, datasets, perfReport],
    );

    const largestFreeTraces = useMemo(
        () =>
            datasets.map((data, dataIndex) => {
                const series = buildL1PressureChartSeries(data);
                const label = getPlotLabel(dataIndex, perfReport?.reportName, comparisonReportList);

                return {
                    x: series.x,
                    y: series.largestFreePercent,
                    customdata: series.opCodes,
                    type: 'scatter',
                    mode: 'lines',
                    connectgaps: true,
                    yaxis: 'y2',
                    name: `${label} — L1 max free`,
                    legendgroup: `group${dataIndex}`,
                    showlegend: true,
                    line: {
                        color: getSecondaryDataColours(dataIndex),
                        width: 1.5,
                        dash: 'dot',
                    },
                    hovertemplate:
                        '<b>%{fullData.name}</b><br />Op %{x}: %{customdata}<br />L1 max free: %{y:.1f}%<br /><i>Excludes circular buffers.</i><extra></extra>',
                } as Partial<PlotData>;
            }),
        [comparisonReportList, datasets, perfReport],
    );

    const { shapes, annotations } = useMemo(() => {
        const lines: ThresholdLine[] = [
            {
                y: L1_FULLNESS_WARNING_PERCENT,
                yref: 'y',
                label: 'fullness warn',
                colour: GRAPH_COLORS.l1PressureWarning,
            },
            {
                y: L1_FULLNESS_CRITICAL_PERCENT,
                yref: 'y',
                label: 'fullness critical',
                colour: GRAPH_COLORS.l1PressureCritical,
            },
            {
                y: L1_LARGEST_FREE_WARNING_PERCENT,
                yref: 'y2',
                label: 'max-free warn',
                colour: GRAPH_COLORS.l1PressureWarning,
            },
            {
                y: L1_LARGEST_FREE_CRITICAL_PERCENT,
                yref: 'y2',
                label: 'max-free critical',
                colour: GRAPH_COLORS.l1PressureCritical,
            },
        ];

        const shapeList: Partial<Shape>[] = lines.map((line) => ({
            type: 'line',
            xref: 'paper',
            x0: 0,
            x1: 1,
            yref: line.yref,
            y0: line.y,
            y1: line.y,
            line: {
                color: line.colour,
                width: 1,
                dash: 'dash',
            },
            layer: 'below',
        }));

        const annotationList: Partial<Annotations>[] = lines.map((line) => ({
            xref: 'paper',
            x: line.yref === 'y2' ? 0 : 1,
            xanchor: line.yref === 'y2' ? 'left' : 'right',
            yref: line.yref,
            y: line.y,
            yanchor: 'bottom',
            text: `${line.label} ${line.y}%`,
            showarrow: false,
            font: {
                color: line.colour,
                size: 10,
            },
        }));

        return { shapes: shapeList, annotations: annotationList };
    }, []);

    const configuration: PlotConfiguration = {
        margin: {
            l: 60,
            r: 60,
            b: 50,
            t: 0,
        },
        showLegend: true,
        xAxis: {
            title: { text: 'Operation' },
            range: [0, maxDataSize],
        },
        yAxis: {
            title: { text: 'L1 fullness %' },
            range: [0, 100],
            tickformat: '.0f',
            hoverformat: '.1f',
        },
        yAxis2: {
            title: { text: 'L1 max free %' },
            range: [0, 100],
            tickformat: '.0f',
            hoverformat: '.1f',
        },
        shapes,
        annotations,
    };

    return (
        <PerfChart
            title='L1 Pressure Along Execution Order'
            chartData={[...fullnessTraces, ...largestFreeTraces]}
            configuration={configuration}
        />
    );
}

export default PerfL1PressureChart;
