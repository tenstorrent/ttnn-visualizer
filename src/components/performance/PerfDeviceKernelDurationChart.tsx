// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { RowData } from '../../definitions/PerfTable';
import PerfChart from './PerfChart';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';

interface PerfDeviceKernelDurationChartProps {
    data?: RowData[];
}

function PerfDeviceKernelDurationChart({ data }: PerfDeviceKernelDurationChartProps) {
    const filteredOps = data?.filter((row) => row?.['DEVICE KERNEL DURATION [ns]']);

    const chartData = useMemo(
        () =>
            ({
                x: filteredOps?.map((_row, index) => index + 1) ?? [],
                y: filteredOps?.map((row) => row['DEVICE KERNEL DURATION [ns]']),
                type: 'scatter',
                mode: 'lines',
                name: '',
                hovertemplate: `Operation: %{x}<br />Duration: %{y} ns`,
            }) as Partial<PlotData>,
        [filteredOps],
    );

    const configuration: PlotConfiguration = {
        xAxis: {
            title: {
                text: 'Operation',
            },
            range: [0, chartData.x?.length ?? 0] as [number, number],
        },
        yAxis: {
            title: {
                text: 'Device Kernel Duration (ns)',
            },
            tickformat: 'd',
            hoverformat: ',.2r',
            range: [0, Math.max(...(chartData.y as number[]))] as [number, number],
        },
    };

    return (
        <PerfChart
            title='Device Kernel Duration'
            chartData={[chartData]}
            configuration={configuration}
        />
    );
}

export default PerfDeviceKernelDurationChart;
