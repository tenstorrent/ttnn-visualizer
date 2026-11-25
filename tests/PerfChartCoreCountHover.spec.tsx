// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { Layout, PlotData } from 'plotly.js';
import { ReactElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPlotInstances, resetPlotPropsCapture } from './mocks/plotComponent';
import PerfCoreCountUtilizationChart from '../src/components/performance/PerfCoreCountUtilizationChart';
import PerfDeviceKernelRuntimeChart from '../src/components/performance/PerfDeviceKernelRuntimeChart';
import { PerfChartId } from '../src/definitions/PerformanceCharts';
import { TestProviders } from './helpers/TestProviders';
import { formatPlotlyHoverY } from './helpers/plotlyHoverValue';
import { makeTypedPerfRow } from './helpers/perfRowFixtures';

vi.mock('../src/hooks/useAPI', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/hooks/useAPI')>()),
    usePerfMeta: () => ({ data: undefined }),
}));

// The active report and a comparison report. Two significant digits would show 108 and 117 as 110 and 120.
const CORE_COUNTS = [
    [108, 117],
    [117, 108],
];
const EXPECTED_HOVER_VALUES = [
    ['108', '117'],
    ['117', '108'],
];

const datasets = CORE_COUNTS.map((counts) => counts.map((cores) => makeTypedPerfRow({ cores })));

afterEach(() => {
    cleanup();
    resetPlotPropsCapture();
});

describe('Core count tooltips', () => {
    it.each<{ name: string; renderChart: () => ReactElement }>([
        {
            name: 'Core Count + Utilization (matmul)',
            renderChart: () => (
                <PerfCoreCountUtilizationChart
                    datasets={datasets}
                    maxCores={140}
                    chartId={PerfChartId.MatmulCoreCountUtilization}
                />
            ),
        },
        {
            name: 'Core Count + Utilization (conv)',
            renderChart: () => (
                <PerfCoreCountUtilizationChart
                    datasets={datasets}
                    maxCores={140}
                    chartId={PerfChartId.ConvCoreCountUtilization}
                />
            ),
        },
        {
            name: 'Core Count + Device Kernel Runtime',
            renderChart: () => <PerfDeviceKernelRuntimeChart datasets={datasets} />,
        },
    ])('$name shows the exact core count for every report', ({ renderChart }) => {
        render(<TestProviders>{renderChart()}</TestProviders>);

        const plot = getPlotInstances()[0];
        const layout = plot?.layout as Partial<Layout>;
        const coreTraces = (plot?.data as Partial<PlotData>[]).filter((trace) =>
            String(trace.hovertemplate).includes('Cores: %{y}'),
        );

        expect(coreTraces).toHaveLength(CORE_COUNTS.length);
        coreTraces.forEach((trace, index) => {
            // On y2, or with its own yhoverformat, a trace would hover through a format other than the core-count axis's.
            expect(trace.yaxis ?? 'y').toBe('y');
            expect(trace.yhoverformat).toBeUndefined();
            expect(trace.y).toEqual(CORE_COUNTS[index]);

            // What `%{y}` fills in after "Cores: ".
            expect(CORE_COUNTS[index].map((cores) => formatPlotlyHoverY(cores, trace, layout.yaxis))).toEqual(
                EXPECTED_HOVER_VALUES[index],
            );
        });
    });
});
