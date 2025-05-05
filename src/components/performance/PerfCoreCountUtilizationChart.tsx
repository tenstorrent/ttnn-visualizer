// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { PerfTableRow } from '../../definitions/PerfTable';
import getCoreUtilization from '../../functions/getCoreUtilization';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';
import PerfChart from './PerfChart';
import { activePerformanceReportAtom, comparisonPerformanceReportAtom } from '../../store/app';
import getPlotLabel from '../../functions/getPlotLabel';
import { getAxisUpperRange } from '../../functions/perfFunctions';
import { getPrimaryDataColours, getSecondaryDataColours } from '../../definitions/PerformancePlotColours';

interface PerfCoreCountUtilizationChartProps {
    datasets?: PerfTableRow[][];
    maxCores: number;
}

function PerfCoreCountUtilizationChart({ datasets = [], maxCores }: PerfCoreCountUtilizationChartProps) {
    const perfReport = useAtomValue(activePerformanceReportAtom);
    const comparisonReport = useAtomValue(comparisonPerformanceReportAtom);

    const chartDataDuration = useMemo(
        () =>
            datasets.map((data, dataIndex) => ({
                x: data?.map((_row, index) => index + 1),
                y: data?.map((row) => row.cores),
                type: 'bar',
                hovertemplate: `<b>%{data.name}</b><br />Operation: %{x}<br />Cores: %{y}<extra></extra>`,
                name: getPlotLabel(dataIndex, perfReport, comparisonReport),
                legendgroup: `group${dataIndex}`,
                marker: {
                    color: getPrimaryDataColours(dataIndex),
                },
            })) as Partial<PlotData>[],
        [datasets, perfReport, comparisonReport],
    );

    const chartDataUtilization = useMemo(
        () =>
            datasets.map((data, dataIndex) => ({
                x: data?.map((_row, index) => index + 1),
                y: data?.map((row) => getCoreUtilization(row, maxCores)).filter((value) => value !== -1),
                yaxis: 'y2',
                hovertemplate: `<b>%{data.name}</b><br />Operation: %{x}<br />Utilization: %{y}<extra></extra>`,
                name: getPlotLabel(dataIndex, perfReport, comparisonReport),
                legendgroup: `group${dataIndex}`,
                marker: {
                    color: getSecondaryDataColours(dataIndex),
                },
            })) as Partial<PlotData>[],
        [datasets, perfReport, comparisonReport, maxCores],
    );

    const configuration: PlotConfiguration = {
        margin: {
            l: 100,
            r: 0,
            b: 50,
            t: 0,
        },
        showLegend: true,
        xAxis: {
            title: { text: 'Operation' },
            range: [0, getAxisUpperRange(datasets, !!comparisonReport)],
        },
        yAxis: {
            title: { text: 'Core Count' },
            tickformat: 'd',
            hoverformat: ',.2r',
            range: [0, maxCores],
        },
        yAxis2: {
            title: { text: 'Utilization (%)' },
            tickformat: '.0%',
            hoverformat: '.2%',
            range: [0, 1],
        },
    };

    return (
        <PerfChart
            title='Core Count + Utilization'
            chartData={[...chartDataDuration, ...chartDataUtilization]}
            configuration={configuration}
        />
    );
}

export default PerfCoreCountUtilizationChart;
