// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Layout, PlotData } from 'plotly.js';
import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import 'styles/components/PerformanceScatterChart.scss';
import { RowData } from '../definitions/PerfTable';
import { PerfChartConfig } from '../definitions/PlotConfigurations';

interface PerformanceDeviceKernelDurationChartProps {
    data?: RowData[];
}

const GRID_COLOUR = '#575757';
const LEGEND_COLOUR = '#FFF';

function PerformanceDeviceKernelDurationChart({ data }: PerformanceDeviceKernelDurationChartProps) {
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
        autosize: true,
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        margin: {
            l: 50,
            r: 0,
            b: 50,
            t: 0,
        },
        xaxis: {
            gridcolor: GRID_COLOUR,
            linecolor: GRID_COLOUR,
            color: LEGEND_COLOUR,
            title: {
                text: 'Operation',
                font: {
                    color: LEGEND_COLOUR,
                },
            },
            range: [0, chartData.x?.length ?? 0],
            fixedrange: true,
            zeroline: false,
        },
        yaxis: {
            gridcolor: GRID_COLOUR,
            linecolor: GRID_COLOUR,
            color: LEGEND_COLOUR,
            title: {
                text: 'Device Kernel Duration (ns)',
                font: {
                    color: LEGEND_COLOUR,
                },
                standoff: 20,
            },
            tickformat: 'd',
            hoverformat: ',.2r',
            range: [0, Math.max(...(chartData.y as number[]))],
            automargin: true,
            fixedrange: true,
            zeroline: false,
        },
    };

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

export default PerformanceDeviceKernelDurationChart;
