// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { RowData } from '../../definitions/PerfTable';
import getCoreUtilization from '../../functions/getCoreUtilization';
import PerfChart from './PerfChart';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';

interface PerfOperationKernelUtilizationChartProps {
    data?: RowData[];
    maxCores: number;
}

function PerfOperationKernelUtilizationChart({ data, maxCores }: PerfOperationKernelUtilizationChartProps) {
    const chartDataDuration = useMemo(
        () =>
            ({
                x: data?.map((_row, index) => index + 1),
                y: data?.map((row) => row['DEVICE KERNEL DURATION [ns]']),
                type: 'bar',
                hovertemplate: `Operation: %{x}<br />Duration: %{y} ns`,
                name: '',
            }) as Partial<PlotData>,
        [data],
    );

    const chartDataUtilization = useMemo(
        () =>
            ({
                x: data?.map((_row, index) => index + 1),
                y: data?.map((row) => getCoreUtilization(row, maxCores)).filter((value) => value !== -1) ?? [],
                yaxis: 'y2',
                hovertemplate: `Operation: %{x}<br />Utilization: %{y}`,
                name: '',
            }) as Partial<PlotData>,
        [data, maxCores],
    );

    const configuration: PlotConfiguration = {
        margin: {
            l: 100,
            r: 0,
            b: 50,
            t: 0,
        },
        xAxis: {
            range: [0, data?.length ?? 0],
            title: {
                text: 'Operation',
            },
        },
        yAxis: {
            title: {
                text: 'Device Kernel Duration (ns)',
            },
            tickformat: 'd',
            hoverformat: ',.2r',
            range: [0, Math.max(...(chartDataDuration.y as number[]))],
        },
        yAxis2: {
            title: {
                text: 'Utilization (%)',
            },
            tickformat: '.0%',
            hoverformat: '.2%',
            range: [0, 1],
        },
    };

    return (
        <PerfChart
            title='Operation Device Kernel Duration + Utilization (MatMul)'
            chartData={[chartDataDuration, chartDataUtilization]}
            configuration={configuration}
        />
    );
}

export default PerfOperationKernelUtilizationChart;
