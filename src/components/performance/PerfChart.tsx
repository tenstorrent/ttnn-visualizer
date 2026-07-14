// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Layout, PlotData, PlotMouseEvent } from 'plotly.js';
import classNames from 'classnames';
import { ReactNode } from 'react';
import Plot from '../../libs/PlotComponent';
import { PerfChartConfig, PerfChartLayout, PlotConfiguration } from '../../definitions/PlotConfigurations';
import PerfChartFrame from './PerfChartFrame';
import 'styles/components/PerfChart.scss';

interface PerfChartProps {
    chartData: Partial<PlotData>[];
    configuration?: PlotConfiguration;
    id?: string;
    title: string;
    subtitle?: ReactNode;
    className?: string;
    /** When set, used as Plot layout instead of the Cartesian builder from configuration. */
    layout?: Partial<Layout>;
    onPlotClick?: (event: Readonly<PlotMouseEvent>) => void;
}

function getCartesianLayout(configuration: PlotConfiguration): Partial<Layout> {
    return {
        ...PerfChartLayout,
        showlegend: configuration.showLegend || false,
        margin: configuration.margin ?? PerfChartLayout.margin,
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
        barmode: configuration.barMode,
        xaxis: {
            ...PerfChartLayout.xaxis,
            title: {
                ...PerfChartLayout.xaxis?.title,
                text: configuration.xAxis?.title?.text,
            },
            range: configuration.xAxis?.range,
            tickformat: configuration.xAxis?.tickformat,
            hoverformat: configuration.xAxis?.hoverformat,
        },
        yaxis: {
            ...PerfChartLayout.yaxis,
            title: {
                ...PerfChartLayout.yaxis?.title,
                text: configuration.yAxis?.title?.text,
            },
            range: configuration.yAxis?.range,
            tickformat: configuration.yAxis?.tickformat,
            hoverformat: configuration.yAxis?.hoverformat,
        },
        yaxis2: {
            ...PerfChartLayout.yaxis2,
            title: {
                ...PerfChartLayout.yaxis2?.title,
                text: configuration.yAxis2?.title?.text,
            },
            range: configuration.yAxis2?.range,
            tickformat: configuration.yAxis2?.tickformat,
            hoverformat: configuration.yAxis2?.hoverformat,
        },
    };
}

function PerfChart({
    chartData,
    configuration = {},
    id,
    title,
    subtitle,
    className,
    layout: layoutOverride,
    onPlotClick,
}: PerfChartProps) {
    const isClickable = onPlotClick != null;
    const layout = layoutOverride ?? getCartesianLayout(configuration);

    return (
        <PerfChartFrame
            id={id}
            className={classNames('chart-container', className, {
                'legend-instructions': configuration.showLegend,
            })}
            title={title}
            subtitle={subtitle}
            isClickable={isClickable}
        >
            <Plot
                className='chart'
                data={chartData}
                layout={layout}
                config={PerfChartConfig}
                onClick={onPlotClick}
                useResizeHandler
            />
        </PerfChartFrame>
    );
}

export default PerfChart;
