// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Config, Layout, PlotData } from 'plotly.js';
import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import { RowData } from '../definitions/PerfTable';
import { DeviceArchitecture } from '../model/APIData';
import 'styles/components/PerformanceScatterChart.scss';
import getCoreUtilization from '../functions/getCoreUtilization';

interface PerformanceKernelDurationUtilizationChartProps {
    data?: RowData[];
    architecture: DeviceArchitecture;
}

const GRID_COLOUR = '#575757';
const LEGEND_COLOUR = '#FFF';

const CONFIG: Partial<Config> = {
    displayModeBar: false,
    displaylogo: false,
    responsive: true,
};

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
        autosize: true,
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        showlegend: false,
        margin: {
            l: 60,
            r: 70,
            b: 50,
            t: 0,
        },
        xaxis: {
            gridcolor: GRID_COLOUR,
            linecolor: GRID_COLOUR,
            color: LEGEND_COLOUR,
            title: {
                text: 'Device Kernel Duration (ns)',
                font: {
                    color: LEGEND_COLOUR,
                },
            },
            automargin: true,
            tickformat: 'd',
            hoverformat: ',.2r',
            fixedrange: true,
        },
        yaxis: {
            gridcolor: GRID_COLOUR,
            linecolor: GRID_COLOUR,
            color: LEGEND_COLOUR,
            title: {
                text: 'Utilization (%)',
                font: {
                    color: LEGEND_COLOUR,
                },
                standoff: 40,
            },
            tickformat: '.0%',
            hoverformat: '.2%',
            automargin: true,
            fixedrange: true,
        },
    };

    return (
        <div className='scatter-chart'>
            <h3>Device Kernel Duration vs Utilization (Matmul)</h3>

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

const isMatMulConv = (operation?: string): boolean => {
    const opCode = operation?.toLowerCase();
    const keywords = ['matmul', 'conv'];

    return keywords.some((keyword) => opCode?.includes(keyword));
};

export default PerformanceKernelDurationUtilizationChart;
