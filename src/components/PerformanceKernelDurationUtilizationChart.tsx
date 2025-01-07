// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Layout, PlotData } from 'plotly.js';
import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import { RowData } from '../definitions/PerfTable';
import { DeviceArchitecture } from '../model/APIData';
import 'styles/components/PerformanceScatterChart.scss';
import getCoreUtilization from '../functions/getCoreUtilization';
import { PerfChartConfig, PerfChartLayout } from '../definitions/PlotConfigurations';

interface PerformanceKernelDurationUtilizationChartProps {
    data?: RowData[];
    architecture: DeviceArchitecture;
}

function PerformanceKernelDurationUtilizationChart({
    data,
    architecture,
}: PerformanceKernelDurationUtilizationChartProps) {
    const filteredOps = data?.filter((row) => isMatMulConv(row?.['OP CODE'] as string | undefined));

    const chartData = useMemo(
        () =>
            ({
                x: filteredOps?.map((row) => row['DEVICE KERNEL DURATION [ns]']),
                y: filteredOps?.map((row) => getCoreUtilization(row, architecture)).filter((value) => value !== -1),
                mode: 'markers',
                type: 'scatter',
                name: '',
                marker: {
                    size: 10,
                },
                hovertemplate: `Duration: %{x} ns<br />Utilization: %{y}`,
            }) as Partial<PlotData>,
        [filteredOps, architecture],
    );

    const layout: Partial<Layout> = {
        ...PerfChartLayout,
        xaxis: {
            ...PerfChartLayout.xaxis,
            tickformat: 'd',
            hoverformat: ',.2r',
        },
        yaxis: {
            ...PerfChartLayout.yaxis,
            tickformat: '.0%',
            hoverformat: '.2%',
        },
    };

    if (layout?.xaxis?.title && typeof layout.xaxis.title !== 'string') {
        layout.xaxis.title.text = 'Device Kernel Duration (ns)';
    }
    if (layout?.yaxis?.title && typeof layout.yaxis.title !== 'string') {
        layout.yaxis.title.text = 'Utilization (%)';
    }

    return (
        <div className='scatter-chart'>
            <h3>Device Kernel Duration vs Utilization (Matmul)</h3>

            <Plot
                className='chart'
                data={[chartData]}
                layout={layout}
                config={PerfChartConfig}
                useResizeHandler
            />
        </div>
    );
}

const isMatMulConv = (operation?: string): boolean => {
    const opCode = operation?.toLowerCase();
    const keywords = ['matmul', 'conv'];

    return keywords.some((keyword) => opCode?.includes(keyword));
};

export default PerformanceKernelDurationUtilizationChart;
