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
import { TypedPerfTableRow } from '../src/model/PerfTable';
import { OpType } from '../src/definitions/Performance';
import { TestProviders } from './helpers/TestProviders';
import { formatPlotlyHoverY } from './helpers/plotlyHoverValue';

vi.mock('../src/hooks/useAPI', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/hooks/useAPI')>()),
    usePerfMeta: () => ({ data: undefined }),
}));

// Two significant digits would show these as 110 and 120.
const CORE_COUNTS = [108, 117];

const row = (cores: number): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        op_code: 'Matmul',
        raw_op_code: 'Matmul',
        cores,
        device_time: 1_000,
        advice: [],
        bound: null,
        isFirstHashOccurrence: true,
        id: 1,
    }) as unknown as TypedPerfTableRow;

const datasets = [CORE_COUNTS.map(row)];

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
    ])('$name shows the exact core count', ({ renderChart }) => {
        render(<TestProviders>{renderChart()}</TestProviders>);

        const plot = getPlotInstances()[0];
        const layout = plot?.layout as Partial<Layout>;
        const coreTraces = (plot?.data as Partial<PlotData>[]).filter((trace) =>
            String(trace.hovertemplate).includes('Cores: %{y}'),
        );

        expect(coreTraces).toHaveLength(1);
        const [coreTrace] = coreTraces;
        // A trace on y2 would hover through the duration or utilization axis format instead.
        expect(coreTrace.yaxis ?? 'y').toBe('y');
        expect(coreTrace.y).toEqual(CORE_COUNTS);

        // What `%{y}` fills in after "Cores: ".
        expect(CORE_COUNTS.map((cores) => formatPlotlyHoverY(cores, coreTrace, layout.yaxis))).toEqual(['108', '117']);
    });
});
