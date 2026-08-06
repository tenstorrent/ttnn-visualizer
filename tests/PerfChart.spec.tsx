// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import type { Layout, PlotData } from 'plotly.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { firePlotClick, getPlotInstances, resetPlotPropsCapture } from './mocks/plotComponent';
import PerfChart from '../src/components/performance/PerfChart';
import { PERF_CHART_TABLE_FILTER_HINT } from '../src/definitions/PerformanceCharts';
import {
    NS_AXIS_HOVER_FORMAT,
    NS_AXIS_TICK_FORMAT,
    PerfPieChartLayout,
    getNsAxisConfig,
    getPerfChartLayout,
} from '../src/definitions/PlotConfigurations';
import { TEST_IDS } from '../src/definitions/TestIds';

afterEach(() => {
    cleanup();
    resetPlotPropsCapture();
});

const barData = [{ type: 'bar', x: ['a'], y: [1] } as Partial<PlotData>];
const baseLayout = getPerfChartLayout();

describe('PerfChart', () => {
    it('forwards onPlotClick to Plot and shows the table-filter hint when clickable', () => {
        const onPlotClick = vi.fn();

        render(
            <PerfChart
                title='Test chart'
                chartData={barData}
                configuration={{}}
                onPlotClick={onPlotClick}
            />,
        );

        expect(screen.getAllByTestId(TEST_IDS.PERF_CHART_HINT).map((hint) => hint.textContent)).toEqual([
            PERF_CHART_TABLE_FILTER_HINT,
        ]);

        firePlotClick({ points: [{ customdata: 'Matmul' }] } as never);
        expect(onPlotClick).toHaveBeenCalledTimes(1);
    });

    it('does not show the hint when the chart is not clickable', () => {
        render(
            <PerfChart
                title='Test chart'
                chartData={barData}
                configuration={{}}
            />,
        );

        expect(screen.queryAllByTestId(TEST_IDS.PERF_CHART_HINT)).toHaveLength(0);
    });

    it('renders subtitle when provided', () => {
        render(
            <PerfChart
                title='Test chart'
                subtitle={<p>active-report</p>}
                chartData={barData}
                configuration={{}}
            />,
        );

        expect(screen.getByText('active-report')).toBeInTheDocument();
    });

    it('forwards className onto the chart frame', () => {
        const { container } = render(
            <PerfChart
                title='Test chart'
                chartData={barData}
                configuration={{}}
                className='flex-chart'
            />,
        );

        expect(container.querySelector('.chart-container.flex-chart')).toBeInTheDocument();
    });

    it('forwards a custom layout override without injecting Cartesian axes', () => {
        render(
            <PerfChart
                title='Pie chart'
                chartData={[{ type: 'pie', values: [1], labels: ['a'] } as Partial<PlotData>]}
                layout={PerfPieChartLayout}
            />,
        );

        const plotLayout = getPlotInstances()[0]?.layout as Partial<Layout> | undefined;
        expect(plotLayout).toEqual(PerfPieChartLayout);
        expect(plotLayout).not.toBe(PerfPieChartLayout);
        expect(plotLayout?.margin).not.toBe(PerfPieChartLayout.margin);
        expect(plotLayout?.xaxis).toBeUndefined();
        expect(plotLayout?.yaxis).toBeUndefined();
    });

    it('does not apply legend-instructions when a custom layout is supplied', () => {
        const { container } = render(
            <PerfChart
                title='Pie chart'
                chartData={[{ type: 'pie', values: [1], labels: ['a'] } as Partial<PlotData>]}
                layout={PerfPieChartLayout}
                className='flex-chart'
            />,
        );

        expect(container.querySelector('.legend-instructions')).not.toBeInTheDocument();
        expect(container.querySelector('.chart-container.flex-chart')).toBeInTheDocument();
    });

    it('applies legend-instructions for Cartesian charts with showLegend', () => {
        const { container } = render(
            <PerfChart
                title='Test chart'
                chartData={barData}
                configuration={{ showLegend: true }}
            />,
        );

        expect(container.querySelector('.chart-container.legend-instructions')).toBeInTheDocument();
    });

    it('merges configuration into the Cartesian layout from getPerfChartLayout', () => {
        const nsAxis = getNsAxisConfig('Time (ns)', {
            range: [0, 1_000_000],
            tickvals: [0, 500_000, 1_000_000],
        });

        render(
            <PerfChart
                title='Test chart'
                chartData={barData}
                configuration={{
                    margin: { l: 100, r: 0, b: 50, t: 0 },
                    xAxis: getNsAxisConfig('Operation', { tickformat: 'd' }),
                    yAxis: nsAxis,
                    yAxis2: { tickformat: NS_AXIS_TICK_FORMAT },
                }}
            />,
        );

        const plotLayout = getPlotInstances()[0]?.layout as Partial<Layout> | undefined;
        expect(plotLayout?.paper_bgcolor).toBe('transparent');
        expect(plotLayout?.plot_bgcolor).toBe('transparent');
        expect(plotLayout?.margin).toEqual({ l: 100, r: 0, b: 50, t: 0 });
        expect(plotLayout?.xaxis?.fixedrange).toBe(true);
        expect(plotLayout?.xaxis?.title?.text).toBe('Operation');
        expect(plotLayout?.xaxis?.tickformat).toBe('d');
        expect(plotLayout?.yaxis?.fixedrange).toBe(true);
        expect(plotLayout?.yaxis2?.overlaying).toBe('y');
        expect(plotLayout?.yaxis?.title?.text).toBe('Time (ns)');
        expect(plotLayout?.yaxis?.tickformat).toBe(NS_AXIS_TICK_FORMAT);
        expect(plotLayout?.yaxis?.hoverformat).toBe(NS_AXIS_HOVER_FORMAT);
        expect(plotLayout?.yaxis?.range).toEqual([0, 1_000_000]);
        expect(plotLayout?.yaxis?.tickvals).toEqual([0, 500_000, 1_000_000]);
        expect(plotLayout?.yaxis2?.tickformat).toBe(NS_AXIS_TICK_FORMAT);
        expect(plotLayout?.yaxis?.title?.font).toEqual(baseLayout.yaxis?.title?.font);
        // Base title fields beyond font must survive merge (naive title replace would drop these).
        expect(plotLayout?.yaxis?.title?.standoff).toBe(baseLayout.yaxis?.title?.standoff);
        expect(plotLayout?.yaxis?.automargin).toBe(true);
        expect(plotLayout?.yaxis2?.title?.standoff).toBe(baseLayout.yaxis2?.title?.standoff);
        expect(plotLayout?.yaxis2?.automargin).toBe(true);
        expect(plotLayout?.yaxis2?.side).toBe('right');
    });

    it('lets a caller widen the axis title standoff without dropping the base title font', () => {
        const CALLER_STANDOFF = 34;

        render(
            <PerfChart
                title='Test chart'
                chartData={barData}
                configuration={{
                    xAxis: { title: { text: 'Device time', standoff: CALLER_STANDOFF }, showticklabels: false },
                }}
            />,
        );

        const plotLayout = getPlotInstances()[0]?.layout as Partial<Layout> | undefined;
        expect(plotLayout?.xaxis?.title?.text).toBe('Device time');
        expect(plotLayout?.xaxis?.title?.standoff).toBe(CALLER_STANDOFF);
        expect(plotLayout?.xaxis?.title?.font).toEqual(baseLayout.xaxis?.title?.font);
        expect(plotLayout?.xaxis?.showticklabels).toBe(false);
    });

    // The layout defaults used to be a module singleton that Plotly could mutate in place; the
    // factory is what now makes that impossible, so it is the thing worth pinning.
    it('builds independent layout defaults per call rather than sharing nested objects', () => {
        const first = getPerfChartLayout();
        const second = getPerfChartLayout();

        expect(first).toEqual(second);
        expect(first.margin).not.toBe(second.margin);
        expect(first.yaxis?.title?.font).not.toBe(second.yaxis?.title?.font);
    });

    it('applies an explicit all-zero margin rather than falling back to defaults', () => {
        render(
            <PerfChart
                title='Test chart'
                chartData={barData}
                configuration={{
                    margin: { l: 0, r: 0, b: 0, t: 0 },
                }}
            />,
        );

        const plotLayout = getPlotInstances()[0]?.layout as Partial<Layout> | undefined;
        expect(plotLayout?.margin).toEqual({ l: 0, r: 0, b: 0, t: 0 });
        expect(plotLayout?.margin).not.toEqual(baseLayout.margin);
    });

    it('forwards annotations without sharing the caller-memoized objects', () => {
        const annotation = { x: '1 µs – 10 µs', text: '1 µs – 10 µs', font: { color: '#FFF' } };
        const annotations = [annotation];

        render(
            <PerfChart
                title='Test chart'
                chartData={barData}
                configuration={{ annotations }}
            />,
        );

        const plotLayout = getPlotInstances()[0]?.layout as Partial<Layout> | undefined;
        expect(plotLayout?.annotations).toEqual(annotations);
        expect(plotLayout?.annotations).not.toBe(annotations);
        expect(plotLayout?.annotations?.[0]).not.toBe(annotation);
        expect(plotLayout?.annotations?.[0]?.font).not.toBe(annotation.font);
    });

    it('omits annotations from the layout when configuration supplies none', () => {
        render(
            <PerfChart
                title='Test chart'
                chartData={barData}
                configuration={{}}
            />,
        );

        const plotLayout = getPlotInstances()[0]?.layout as Partial<Layout> | undefined;
        expect(plotLayout?.annotations).toBeUndefined();
    });

    it('falls back to the shared layout margin when configuration omits margin', () => {
        render(
            <PerfChart
                title='Test chart'
                chartData={barData}
                configuration={{}}
            />,
        );

        const plotLayout = getPlotInstances()[0]?.layout as Partial<Layout> | undefined;
        expect(plotLayout?.margin).toEqual(baseLayout.margin);
    });
});
