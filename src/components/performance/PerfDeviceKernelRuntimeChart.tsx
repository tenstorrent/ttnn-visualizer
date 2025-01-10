// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { RowData } from '../../definitions/PerfTable';
import PerfChart from './PerfChart';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';

interface PerfDeviceKernelRuntimeChartProps {
    data?: RowData[];
}

function PerfDeviceKernelRuntimeChart({ data }: PerfDeviceKernelRuntimeChartProps) {
    const filteredOps = data?.filter((row) => row?.['CORE COUNT'] && row?.['DEVICE KERNEL DURATION [ns]']);

    const chartData = useMemo(
        () =>
            ({
                x: filteredOps?.map((row) => row['CORE COUNT']),
                y: filteredOps?.map((row) => row['DEVICE KERNEL DURATION [ns]']),
                mode: 'markers',
                type: 'scatter',
                name: '',
                marker: {
                    size: 10,
                },
                hovertemplate: `Cores: %{x}<br />Duration: %{y} ns`,
            }) as Partial<PlotData>,
        [filteredOps],
    );

    const configuration: Partial<PlotConfiguration> = {
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
            title='Device Kernel Runtime vs Core Count'
            chartData={[chartData]}
            configuration={configuration}
        />
    );
}

export default PerfDeviceKernelRuntimeChart;
