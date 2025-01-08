// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Layout, PlotData } from 'plotly.js';
import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import 'styles/components/PerformanceScatterChart.scss';
import { RowData } from '../definitions/PerfTable';
import { PerfChartConfig, PerfChartLayout } from '../definitions/PlotConfigurations';

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

    const layout: Partial<Layout> = {
        ...PerfChartLayout,
        xaxis: {
            ...PerfChartLayout.xaxis,
            range: [0, chartData.x?.length ?? 0],
        },
        yaxis: {
            ...PerfChartLayout.yaxis,
            tickformat: 'd',
            hoverformat: ',.2r',
            range: [0, Math.max(...(chartData.y as number[]))],
        },
    };

    if (layout?.xaxis?.title && typeof layout.xaxis.title !== 'string') {
        layout.xaxis.title.text = 'Operation';
    }
    if (layout?.yaxis?.title && typeof layout.yaxis.title !== 'string') {
        layout.yaxis.title.text = 'Device Kernel Duration (ns)';
    }

    return (
        <div className='scatter-chart'>
            <h3>Device Kernel Duration</h3>

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

export default PerfDeviceKernelDurationChart;
