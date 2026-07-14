// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { Layout, PlotData } from 'plotly.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { firePlotClick, getPlotInstances, resetPlotPropsCapture } from './mocks/plotComponent';
import PerfChart from '../src/components/performance/PerfChart';
import { PERF_CHART_TABLE_FILTER_HINT } from '../src/definitions/PerformanceCharts';
import { NS_AXIS_HOVER_FORMAT, NS_AXIS_TICK_FORMAT, getNsAxisConfig } from '../src/definitions/PlotConfigurations';
import { TEST_IDS } from '../src/definitions/TestIds';

afterEach(() => {
    cleanup();
    resetPlotPropsCapture();
});

describe('PerfChart', () => {
    it('forwards onPlotClick to Plot and shows the table-filter hint when clickable', () => {
        const onPlotClick = vi.fn();

        render(
            <PerfChart
                title='Test chart'
                chartData={[{ type: 'bar', x: ['a'], y: [1] } as Partial<PlotData>]}
                onPlotClick={onPlotClick}
            />,
        );

        expect(screen.getByTestId(TEST_IDS.PERF_CHART_TABLE_FILTER_HINT)).toHaveTextContent(
            PERF_CHART_TABLE_FILTER_HINT,
        );

        firePlotClick({ points: [{ customdata: 'Matmul' }] } as never);
        expect(onPlotClick).toHaveBeenCalledTimes(1);
    });

    it('does not show the hint when the chart is not clickable', () => {
        render(
            <PerfChart
                title='Test chart'
                chartData={[{ type: 'bar', x: ['a'], y: [1] } as Partial<PlotData>]}
            />,
        );

        expect(screen.queryByTestId(TEST_IDS.PERF_CHART_TABLE_FILTER_HINT)).not.toBeInTheDocument();
    });

    it('renders subtitle when provided', () => {
        render(
            <PerfChart
                title='Test chart'
                subtitle={<p>active-report</p>}
                chartData={[{ type: 'bar', x: ['a'], y: [1] } as Partial<PlotData>]}
            />,
        );

        expect(screen.getByText('active-report')).toBeInTheDocument();
    });

    it('forwards a custom layout override without injecting Cartesian axes', () => {
        const pieLayout: Partial<Layout> = {
            autosize: true,
            paper_bgcolor: 'transparent',
            showlegend: false,
            margin: { l: 50, r: 50, b: 50, t: 50 },
        };

        render(
            <PerfChart
                title='Pie chart'
                chartData={[{ type: 'pie', values: [1], labels: ['a'] } as Partial<PlotData>]}
                layout={pieLayout}
            />,
        );

        const plotLayout = getPlotInstances()[0]?.layout as Partial<Layout> | undefined;
        expect(plotLayout).toEqual(pieLayout);
        expect(plotLayout?.xaxis).toBeUndefined();
        expect(plotLayout?.yaxis).toBeUndefined();
    });

    it('merges configuration into the Cartesian layout from PerfChartLayout', () => {
        const nsAxis = getNsAxisConfig('Time (ns)', { range: [0, 1_000_000] });

        render(
            <PerfChart
                title='Test chart'
                chartData={[{ type: 'bar', x: ['a'], y: [1] } as Partial<PlotData>]}
                configuration={{
                    yAxis: nsAxis,
                    yAxis2: { tickformat: NS_AXIS_TICK_FORMAT },
                }}
            />,
        );

        const plotLayout = getPlotInstances()[0]?.layout as Partial<Layout> | undefined;
        expect(plotLayout?.paper_bgcolor).toBe('transparent');
        expect(plotLayout?.plot_bgcolor).toBe('transparent');
        expect(plotLayout?.xaxis?.fixedrange).toBe(true);
        expect(plotLayout?.yaxis?.fixedrange).toBe(true);
        expect(plotLayout?.yaxis2?.overlaying).toBe('y');
        expect(plotLayout?.yaxis?.title?.text).toBe('Time (ns)');
        expect(plotLayout?.yaxis?.tickformat).toBe(NS_AXIS_TICK_FORMAT);
        expect(plotLayout?.yaxis?.hoverformat).toBe(NS_AXIS_HOVER_FORMAT);
        expect(plotLayout?.yaxis?.range).toEqual([0, 1_000_000]);
        expect(plotLayout?.yaxis2?.tickformat).toBe(NS_AXIS_TICK_FORMAT);
    });
});
