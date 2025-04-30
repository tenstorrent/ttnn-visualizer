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
import getPlotLabel from '../../functions/getPlotLabel';
import { activePerformanceReportAtom, comparisonPerformanceReportAtom } from '../../store/app';
import { getPrimaryDataColours } from '../../definitions/PerformancePlotColours';

interface PerfKernelDurationUtilizationChartProps {
    datasets: PerfTableRow[][];
    maxCores: number;
}

function PerfKernelDurationUtilizationChart({ datasets, maxCores }: PerfKernelDurationUtilizationChartProps) {
    const perfReport = useAtomValue(activePerformanceReportAtom);
    const comparisonReport = useAtomValue(comparisonPerformanceReportAtom);

    const chartData = useMemo(
        () =>
            datasets.map((data, dataIndex) => ({
                x: data?.map((row) => row.device_time),
                y: data?.map((row) => getCoreUtilization(row, maxCores)).filter((value) => value !== -1),
                mode: 'markers',
                type: 'scatter',
                name: getPlotLabel(dataIndex, perfReport, comparisonReport),
                marker: {
                    size: 10,
                    color: getPrimaryDataColours(dataIndex),
                },
                hovertemplate: `Duration: %{x} ns<br />Utilization: %{y}`,
            })) as Partial<PlotData>[],
        [datasets, maxCores, perfReport, comparisonReport],
    );

    const configuration: PlotConfiguration = {
        showLegend: true,
        xAxis: {
            title: {
                text: 'Device Kernel Duration (ns)',
            },
            tickformat: 'd',
            hoverformat: ',.2r',
        },
        yAxis: {
            title: {
                text: 'Utilization (%)',
            },
            tickformat: '.0%',
            hoverformat: '.2%',
        },
    };

    return (
        <PerfChart
            title='Utilization vs Device Kernel Duration'
            chartData={chartData}
            configuration={configuration}
        />
    );
}

export default PerfKernelDurationUtilizationChart;
