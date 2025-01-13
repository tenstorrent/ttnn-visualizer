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
    const chartData = useMemo(
        () =>
            ({
                x: data?.map((row) => row['CORE COUNT']),
                y: data?.map((row) => row['DEVICE KERNEL DURATION [ns]']),
                mode: 'markers',
                type: 'scatter',
                name: '',
                marker: {
                    size: 10,
                },
                hovertemplate: `Cores: %{x} ns<br />Device Kernel Duration: %{y}`,
            }) as Partial<PlotData>,
        [data],
    );

    const configuration: PlotConfiguration = {
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
            chartData={[chartData]}
            configuration={configuration}
        />
    );
}

export default PerfDeviceKernelDurationChart;
