// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import type { Layout } from 'plotly.js';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getPlotInstances, resetPlotPropsCapture } from './mocks/plotComponent';
import PerfDeviceKernelDurationChart from '../src/components/performance/PerfDeviceKernelDurationChart';
import PerfDeviceKernelRuntimeChart from '../src/components/performance/PerfDeviceKernelRuntimeChart';
import PerfKernelDurationUtilizationChart from '../src/components/performance/PerfKernelDurationUtilizationChart';
import { PerfChartId } from '../src/definitions/PerformanceCharts';
import {
    CORE_COUNT_AXIS_HOVER_FORMAT,
    CORE_COUNT_AXIS_TICK_FORMAT,
    NS_AXIS_HOVER_FORMAT,
    NS_AXIS_TICK_FORMAT,
} from '../src/definitions/PlotConfigurations';
import { TestProviders } from './helpers/TestProviders';
import { makeTypedPerfRow } from './helpers/perfRowFixtures';

afterEach(() => {
    cleanup();
    resetPlotPropsCapture();
});

describe('PerfChart ns-axis leaf wiring', () => {
    it('wires y-axis ns formats on Kernel Duration vs Core Count', () => {
        render(
            <TestProviders>
                <PerfDeviceKernelDurationChart datasets={[[makeTypedPerfRow()]]} />
            </TestProviders>,
        );

        const plotLayout = getPlotInstances()[0]?.layout as Partial<Layout> | undefined;
        expect(plotLayout?.yaxis?.title?.text).toBe('Device Kernel Duration (ns)');
        expect(plotLayout?.yaxis?.tickformat).toBe(NS_AXIS_TICK_FORMAT);
        expect(plotLayout?.yaxis?.hoverformat).toBe(NS_AXIS_HOVER_FORMAT);
    });

    it('wires x-axis ns formats on Kernel Duration vs Utilization', () => {
        render(
            <TestProviders>
                <PerfKernelDurationUtilizationChart
                    datasets={[[makeTypedPerfRow()]]}
                    maxCores={64}
                    chartId={PerfChartId.MatmulKernelDurationUtilization}
                />
            </TestProviders>,
        );

        const plotLayout = getPlotInstances()[0]?.layout as Partial<Layout> | undefined;
        expect(plotLayout?.xaxis?.title?.text).toBe('Device Kernel Duration (ns)');
        expect(plotLayout?.xaxis?.tickformat).toBe(NS_AXIS_TICK_FORMAT);
        expect(plotLayout?.xaxis?.hoverformat).toBe(NS_AXIS_HOVER_FORMAT);
    });

    it('wires y2 ns formats and keeps core-count y ticks plain integers', () => {
        render(
            <TestProviders>
                <PerfDeviceKernelRuntimeChart datasets={[[makeTypedPerfRow()]]} />
            </TestProviders>,
        );

        const plotLayout = getPlotInstances()[0]?.layout as Partial<Layout> | undefined;
        expect(plotLayout?.yaxis?.title?.text).toBe('Core Count');
        expect(plotLayout?.yaxis?.tickformat).toBe(CORE_COUNT_AXIS_TICK_FORMAT);
        expect(plotLayout?.yaxis?.hoverformat).toBe(CORE_COUNT_AXIS_HOVER_FORMAT);
        expect(plotLayout?.yaxis2?.title?.text).toBe('Device Kernel Duration (ns)');
        expect(plotLayout?.yaxis2?.tickformat).toBe(NS_AXIS_TICK_FORMAT);
        expect(plotLayout?.yaxis2?.hoverformat).toBe(NS_AXIS_HOVER_FORMAT);
    });
});
