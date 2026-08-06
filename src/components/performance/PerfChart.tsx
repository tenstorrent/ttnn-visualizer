// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import type { Annotations, ClickAnnotationEvent, Layout, LayoutAxis, PlotData, PlotMouseEvent } from 'plotly.js';
import classNames from 'classnames';
import { type ReactNode, useMemo } from 'react';
import Plot from '../../libs/PlotComponent';
import {
    AxisConfig,
    PerfChartConfig,
    PlotConfiguration,
    getPerfChartLayout,
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
    /** Fires for annotations declared with `captureevents`, e.g. in-plot filter controls. */
    onAnnotationClick?: (event: Readonly<ClickAnnotationEvent>) => void;
    /** Guidance for in-plot controls this chart draws itself, one line each below the click hint. */
    hints?: string[];
}

/** Custom layout (e.g. pie) — mutually exclusive with configuration. */
type PerfChartCustomLayoutProps = PerfChartSharedProps & {
    layout: Partial<Layout>;
    configuration?: never;
};

/** Cartesian charts — mutually exclusive with custom `layout` (e.g. pie). */
type PerfChartCartesianProps = PerfChartSharedProps & {
    configuration: PlotConfiguration;
    layout?: never;
};

type PerfChartProps = PerfChartCustomLayoutProps | PerfChartCartesianProps;

function mergeAxis(base: Partial<LayoutAxis> | undefined, axis?: AxisConfig): Partial<LayoutAxis> {
    return {
        ...base,
        ...axis,
        // Caller-supplied title fields win, but the base title font survives a title override.
        title: {
            ...base?.title,
            ...axis?.title,
        },
    };
}

/** Callers memoize their annotations, and Plotly writes computed fields into the ones it is handed. */
function cloneAnnotations(annotations: Partial<Annotations>[]): Partial<Annotations>[] {
    return annotations.map((annotation) => ({
        ...annotation,
        ...(annotation.font ? { font: { ...annotation.font } } : {}),
    }));
}

function cloneCustomLayout(layout: Partial<Layout>): Partial<Layout> {
    return {
        ...layout,
        ...(layout.margin ? { margin: { ...layout.margin } } : {}),
    };
}

function getCartesianLayout(configuration: PlotConfiguration): Partial<Layout> {
    const baseLayout = getPerfChartLayout();

    return {
        ...baseLayout,
        showlegend: configuration.showLegend || false,
        margin: { ...(configuration.margin ?? baseLayout.margin!) },
        ...(configuration.annotations ? { annotations: cloneAnnotations(configuration.annotations) } : {}),
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
        xaxis: mergeAxis(baseLayout.xaxis, configuration.xAxis),
        yaxis: mergeAxis(baseLayout.yaxis, configuration.yAxis),
        yaxis2: mergeAxis(baseLayout.yaxis2, configuration.yAxis2),
    };
}

function PerfChart(props: PerfChartProps) {
    const { chartData, id, title, subtitle, className, onPlotClick, onAnnotationClick, hints } = props;
    const isClickable = onPlotClick != null;
    const isCustomLayout = props.layout != null;
    // react-plotly.js diffs layout by reference, so a fresh object here redraws every chart on
    // every render of the owning view. Callers must memoize their configuration to benefit.
    const layout = useMemo(
        () =>
            props.layout != null
                ? // Clone custom layouts — pie charts share PerfPieChartLayout as a module singleton.
                  cloneCustomLayout(props.layout)
                : getCartesianLayout(props.configuration),
        [props.layout, props.configuration],
    );
    // Legend CSS hint is Cartesian-only; custom layout owns its own legend chrome.
    const showLegendInstructions = !isCustomLayout && Boolean(props.configuration?.showLegend);

    return (
        <PerfChartFrame
            id={id}
            className={classNames('chart-container', className, {
                'legend-instructions': showLegendInstructions,
            })}
            title={title}
            subtitle={subtitle}
            isClickable={isClickable}
            hints={hints}
        >
            <Plot
                className='chart'
                data={chartData}
                layout={layout}
                config={PerfChartConfig}
                onClick={onPlotClick}
                onClickAnnotation={onAnnotationClick}
                useResizeHandler
            />
        </PerfChartFrame>
    );
}

export default PerfChart;
