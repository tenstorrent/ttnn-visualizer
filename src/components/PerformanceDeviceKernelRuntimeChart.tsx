// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Layout, PlotData } from 'plotly.js';
import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import 'styles/components/PerformanceScatterChart.scss';
import { RowData } from '../definitions/PerfTable';
import { PerfChartConfig, PerfChartLayout } from '../definitions/PlotConfigurations';

interface PerformanceDeviceKernelRuntimeChartProps {
    data?: RowData[];
}

function PerformanceDeviceKernelRuntimeChart({ data }: PerformanceDeviceKernelRuntimeChartProps) {
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

    const layout: Partial<Layout> = {
        ...PerfChartLayout,
        xaxis: {
            ...PerfChartLayout.xaxis,
        },
        yaxis: {
            ...PerfChartLayout.yaxis,
            tickformat: 'd',
            hoverformat: ',.2r',
        },
    };

    if (layout?.xaxis?.title && typeof layout.xaxis.title !== 'string') {
        layout.xaxis.title.text = 'Core Count';
    }
    if (layout?.yaxis?.title && typeof layout.yaxis.title !== 'string') {
        layout.yaxis.title.text = 'Device Kernel Duration (ns)';
    }

    return (
        <div className='scatter-chart'>
            <h3>Device Kernel Runtime vs Core Count</h3>

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

export default PerformanceDeviceKernelRuntimeChart;
