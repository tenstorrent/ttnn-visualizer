// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Config, Layout, PlotData } from 'plotly.js';
import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import 'styles/components/PerformanceScatterChart.scss';
import { RowData } from '../definitions/PerfTable';

interface PerformanceDeviceKernelRuntimeChartProps {
    data?: RowData[];
}

const GRID_COLOUR = '#575757';
const LEGEND_COLOUR = '#FFF';

const CONFIG: Partial<Config> = {
    displayModeBar: false,
    displaylogo: false,
    responsive: true,
};

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
        autosize: true,
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        showlegend: false,
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
                text: 'Core Count',
                font: {
                    color: LEGEND_COLOUR,
                },
            },
            automargin: true,
            fixedrange: true,
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
            automargin: true,
            fixedrange: true,
        },
    };

    return (
        <div className='scatter-chart'>
            <h3>Device Kernel Runtime vs Core Count</h3>

            <Plot
                className='chart'
                data={[chartData]}
                layout={layout}
                config={CONFIG}
                useResizeHandler
            />
        </div>
    );
}

export default PerformanceDeviceKernelRuntimeChart;
