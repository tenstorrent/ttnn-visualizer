// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Config, Layout, PlotData } from 'plotly.js';
import classNames from 'classnames';
import Plot from 'react-plotly.js';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';
import 'styles/components/PerfChart.scss';

interface PerfChartProps {
    chartData: Partial<PlotData>[];
    configuration: PlotConfiguration;
    title: string;
}

const GRID_COLOUR = '#575757';
const LINE_COLOUR = '#575757';
const LEGEND_COLOUR = '#FFF';

function PerfChart({ chartData, configuration, title }: PerfChartProps) {
    const layout: Partial<Layout> = {
        autosize: true,
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        showlegend: configuration.showLegend || false,
        legend: {
            orientation: 'h',
            font: {
                family: 'sans-serif',
            },
            bgcolor: '#dee2e6', // tt-grey-7
            bordercolor: '#fff', // tt-white
            borderwidth: 2,
            x: 0.5,
            y: -0.25,
            xanchor: 'center',
        },
        margin: {
            l: 50,
            r: 0,
            b: 50,
            t: 0,
        },
        barmode: configuration.barMode,
        xaxis: {
            gridcolor: GRID_COLOUR,
            linecolor: LINE_COLOUR,
            color: LEGEND_COLOUR,
            title: {
                font: {
                    color: LEGEND_COLOUR,
                },
                text: configuration.xAxis?.title?.text,
            },
            fixedrange: true,
            zeroline: false,
            range: configuration.xAxis?.range,
            tickformat: configuration.xAxis?.tickformat,
            hoverformat: configuration.xAxis?.hoverformat,
        },
        yaxis: {
            gridcolor: GRID_COLOUR,
            linecolor: LINE_COLOUR,
            color: LEGEND_COLOUR,
            title: {
                standoff: 20,
                font: {
                    color: LEGEND_COLOUR,
                },
                text: configuration.yAxis?.title?.text,
            },
            automargin: true,
            fixedrange: true,
            zeroline: false,
            range: configuration.yAxis?.range,
            tickformat: configuration.yAxis?.tickformat,
            hoverformat: configuration.yAxis?.hoverformat,
        },
        yaxis2: {
            gridcolor: GRID_COLOUR,
            linecolor: LINE_COLOUR,
            color: LEGEND_COLOUR,
            title: {
                standoff: 20,
                font: {
                    color: LEGEND_COLOUR,
                },
                text: configuration.yAxis2?.title?.text,
            },
            overlaying: 'y',
            side: 'right',
            automargin: true,
            fixedrange: true,
            zeroline: false,
            range: configuration.yAxis2?.range,
            tickformat: configuration.yAxis2?.tickformat,
            hoverformat: configuration.yAxis2?.hoverformat,
        },
    };

    const config: Partial<Config> = {
        displayModeBar: false,
        displaylogo: false,
        responsive: true,
    };

    return (
        <div className={classNames('chart-container', { 'legend-instructions': configuration.showLegend })}>
            <h3>{title}</h3>

            <Plot
                className='chart'
                data={chartData}
                layout={layout}
                config={config}
                useResizeHandler
            />
        </div>
    );
}

export default PerfChart;
