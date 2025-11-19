// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { TypedPerfTableRow } from '../../definitions/PerfTable';
import PerfChart from './PerfChart';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';
import getPlotLabel from '../../functions/getPlotLabel';
import { activePerformanceReportAtom, comparisonPerformanceReportListAtom } from '../../store/app';
import { getPrimaryDataColours } from '../../definitions/PerformancePlotColours';

interface PerfDeviceKernelDurationChartProps {
    datasets?: TypedPerfTableRow[][];
}

function PerfDeviceKernelDurationChart({ datasets = [] }: PerfDeviceKernelDurationChartProps) {
    const perfReport = useAtomValue(activePerformanceReportAtom);
    const comparisonReportList = useAtomValue(comparisonPerformanceReportListAtom);

    const chartData = useMemo(
        () =>
            datasets.map((data, dataIndex) => ({
                x: data?.map((row) => row.cores),
                y: data?.map((row) => row.device_time),
                mode: 'markers',
                type: 'scatter',
                name: getPlotLabel(dataIndex, perfReport?.reportName, comparisonReportList),
                marker: {
                    size: 10,
                    color: getPrimaryDataColours(dataIndex),
                },
                hovertemplate: `Cores: %{x}<br />Device Kernel Duration: %{y} ns`,
            })) as Partial<PlotData>[],
        [datasets, comparisonReportList, perfReport],
    );

    const configuration: PlotConfiguration = {
        showLegend: true,
        xAxis: {
            title: {
                text: 'Core Count',
            },
        },
        yAxis: {
            title: {
                text: 'Device Kernel Duration (ns)',
            },
            tickformat: 'd',
            hoverformat: ',.2r',
        },
    };

    return (
        <PerfChart
            title='Device Kernel Duration vs Core Count'
            chartData={chartData}
            configuration={configuration}
        />
    );
}

export default PerfDeviceKernelDurationChart;
