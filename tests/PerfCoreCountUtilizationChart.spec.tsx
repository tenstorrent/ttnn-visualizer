// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import type { Layout } from 'plotly.js';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getPlotInstances, resetPlotPropsCapture } from './mocks/plotComponent';
import PerfCoreCountUtilizationChart from '../src/components/performance/PerfCoreCountUtilizationChart';
import { PERF_CHART_LABELS, PerfChartId } from '../src/definitions/PerformanceCharts';
import { TypedPerfTableRow } from '../src/definitions/PerfTable';
import { OpType } from '../src/definitions/Performance';
import { TestProviders } from './helpers/TestProviders';

const row = (cores: number): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        op_code: 'Matmul',
        raw_op_code: 'Matmul',
        cores,
        advice: [],
        bound: null,
        isFirstHashOccurrence: true,
        id: 1,
    }) as unknown as TypedPerfTableRow;

afterEach(() => {
    cleanup();
    resetPlotPropsCapture();
});

describe('PerfCoreCountUtilizationChart', () => {
    it('honors its configuration margins and legend frame class', () => {
        const { container } = render(
            <TestProviders>
                <PerfCoreCountUtilizationChart
                    datasets={[[row(8), row(16)]]}
                    maxCores={64}
                    chartId={PerfChartId.MatmulCoreCountUtilization}
                />
            </TestProviders>,
        );

        expect(screen.getByText(PERF_CHART_LABELS[PerfChartId.MatmulCoreCountUtilization])).toBeInTheDocument();

        const plotLayout = getPlotInstances()[0]?.layout as Partial<Layout> | undefined;
        expect(plotLayout?.margin).toEqual({ l: 100, r: 0, b: 50, t: 0 });
        expect(plotLayout?.showlegend).toBe(true);
        expect(container.querySelector('.chart-container.legend-instructions')).toBeInTheDocument();
    });
});
