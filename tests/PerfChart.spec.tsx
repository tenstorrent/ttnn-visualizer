// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PlotData } from 'plotly.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { firePlotClick, resetPlotPropsCapture } from './mocks/plotComponent';
import PerfChart from '../src/components/performance/PerfChart';
import { PERF_CHART_TABLE_FILTER_HINT } from '../src/definitions/PerformanceCharts';
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
                configuration={{}}
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
                configuration={{}}
            />,
        );

        expect(screen.queryByTestId(TEST_IDS.PERF_CHART_TABLE_FILTER_HINT)).not.toBeInTheDocument();
    });
});
