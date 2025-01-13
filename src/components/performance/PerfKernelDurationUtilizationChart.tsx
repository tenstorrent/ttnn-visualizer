// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { RowData } from '../../definitions/PerfTable';
import getCoreUtilization from '../../functions/getCoreUtilization';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';
import PerfChart from './PerfChart';

interface PerfKernelDurationUtilizationChartProps {
    data?: RowData[];
    maxCores: number;
}

function PerfKernelDurationUtilizationChart({ data, maxCores }: PerfKernelDurationUtilizationChartProps) {
    const chartData = useMemo(
        () =>
            ({
                x: data?.map((row) => row['DEVICE KERNEL DURATION [ns]']),
                y: data?.map((row) => getCoreUtilization(row, maxCores)).filter((value) => value !== -1),
                mode: 'markers',
                type: 'scatter',
                name: '',
                marker: {
                    size: 10,
                },
                hovertemplate: `Duration: %{x} ns<br />Utilization: %{y}`,
            }) as Partial<PlotData>,
        [data, maxCores],
    );

    const configuration: PlotConfiguration = {
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
            chartData={[chartData]}
            configuration={configuration}
        />
    );
}

export default PerfKernelDurationUtilizationChart;
