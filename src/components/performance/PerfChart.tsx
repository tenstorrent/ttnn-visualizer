// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import type { Layout, LayoutAxis, PlotData, PlotMouseEvent } from 'plotly.js';
import classNames from 'classnames';
import type { ReactNode } from 'react';
import Plot from '../../libs/PlotComponent';
import {
    AxisConfig,
    PerfChartConfig,
    PerfChartLayout,
    PlotConfiguration,
} from '../../definitions/PlotConfigurations';
import PerfChartFrame from './PerfChartFrame';
import 'styles/components/PerfChart.scss';

interface PerfChartSharedProps {
    chartData: Partial<PlotData>[];
    id?: string;
    title: string;
    subtitle?: ReactNode;
    className?: string;
    onPlotClick?: (event: Readonly<PlotMouseEvent>) => void;
}

/** Custom layout (e.g. pie) — mutually exclusive with configuration. */
type PerfChartCustomLayoutProps = PerfChartSharedProps & {
    layout: Partial<Layout>;
    configuration?: never;
};

/** Cartesian charts — configuration required so axis titles stay compile-checked. */
type PerfChartCartesianProps = PerfChartSharedProps & {
    configuration: PlotConfiguration;
    layout?: never;
};

type PerfChartProps = PerfChartCustomLayoutProps | PerfChartCartesianProps;

function mergeAxis(base: Partial<LayoutAxis> | undefined, axis?: AxisConfig): Partial<LayoutAxis> {
    return {
        ...base,
        ...axis,
        // Fresh title/font objects so Plotly in-place mutation cannot alter PerfChartLayout.
        title: {
            ...base?.title,
            ...(base?.title?.font ? { font: { ...base.title.font } } : {}),
            ...axis?.title,
        },
    };
}

function getCartesianLayout(configuration: PlotConfiguration): Partial<Layout> {
    const defaultMargin = PerfChartLayout.margin ?? { l: 50, r: 0, b: 50, t: 0 };

    return {
        ...PerfChartLayout,
        showlegend: configuration.showLegend || false,
        // Clone margins — never hand Plotly the shared PerfChartLayout.margin reference.
        margin: { ...(configuration.margin ?? defaultMargin) },
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
        xaxis: mergeAxis(PerfChartLayout.xaxis, configuration.xAxis),
        yaxis: mergeAxis(PerfChartLayout.yaxis, configuration.yAxis),
        yaxis2: mergeAxis(PerfChartLayout.yaxis2, configuration.yAxis2),
    };
}

function PerfChart(props: PerfChartProps) {
    const { chartData, id, title, subtitle, className, onPlotClick } = props;
    const isClickable = onPlotClick != null;
    const isCustomLayout = props.layout != null;
    const layout = isCustomLayout ? props.layout : getCartesianLayout(props.configuration);
    // Legend CSS hint is Cartesian-only; custom layout owns its own legend chrome.
    const showLegendInstructions = !isCustomLayout && Boolean(props.configuration.showLegend);

    return (
        <PerfChartFrame
            id={id}
            className={classNames('chart-container', className, {
                'legend-instructions': showLegendInstructions,
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
