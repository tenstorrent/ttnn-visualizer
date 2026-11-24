// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import type { Layout, PlotData } from 'plotly.js';
import type { ReactElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getPlotInstances, resetPlotPropsCapture } from './mocks/plotComponent';
import PerfDeviceKernelDurationChart from '../src/components/performance/PerfDeviceKernelDurationChart';
import PerfDeviceKernelRuntimeChart from '../src/components/performance/PerfDeviceKernelRuntimeChart';
import PerfDeviceTimeChart from '../src/components/performance/PerfDeviceTimeChart';
import PerfKernelDurationUtilizationChart from '../src/components/performance/PerfKernelDurationUtilizationChart';
import PerfOperationKernelUtilizationChart from '../src/components/performance/PerfOperationKernelUtilizationChart';
import { PERF_CHART_LABELS, PerfChartId } from '../src/definitions/PerformanceCharts';
import { OpType } from '../src/definitions/Performance';
import { TypedPerfTableRow } from '../src/model/PerfTable';
import { TestProviders } from './helpers/TestProviders';

const MAX_CORES = 64;

// `device_time` arrives in µs, so these ops run for 370,000, 12,500 and 20,000 ns.
const row = (deviceTimeUs: number | null): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        op_code: 'Matmul',
        raw_op_code: 'Matmul',
        pm_ideal_ns: 5_000,
        device_time: deviceTimeUs,
        cores: 64,
        available_cores: null,
        advice: [],
        bound: null,
        isFirstHashOccurrence: true,
        id: 1,
    }) as unknown as TypedPerfTableRow;

const TWO_REPORTS = [[row(370), row(12.5)], [row(20)]];

interface DeviceTimeChart {
    name: string;
    renderChart: (datasets: TypedPerfTableRow[][]) => ReactElement;
    isDeviceTimeTrace: (trace: Partial<PlotData>) => boolean;
    coordinate: 'x' | 'y';
    axis: 'xaxis' | 'yaxis' | 'yaxis2';
    axisTitle: string;
    hoverText: string;
}

const isBar = (trace: Partial<PlotData>) => trace.type === 'bar';
const isAnyTrace = () => true;

const KERNEL_DURATION_AXIS_TITLE = 'Device Kernel Duration (ns)';

const KERNEL_DURATION_UTILIZATION_CHART: DeviceTimeChart = {
    name: PERF_CHART_LABELS[PerfChartId.MatmulKernelDurationUtilization],
    renderChart: (datasets) => (
        <PerfOperationKernelUtilizationChart
            datasets={datasets}
            maxCores={MAX_CORES}
            chartId={PerfChartId.MatmulKernelDurationUtilization}
        />
    ),
    isDeviceTimeTrace: isBar,
    coordinate: 'y',
    axis: 'yaxis',
    axisTitle: KERNEL_DURATION_AXIS_TITLE,
    hoverText: 'Duration: %{y} ns',
};

// Every chart that plots device time as Device Kernel Duration.
const KERNEL_DURATION_CHARTS: DeviceTimeChart[] = [
    KERNEL_DURATION_UTILIZATION_CHART,
    {
        name: PERF_CHART_LABELS[PerfChartId.MatmulUtilizationVsKernelDuration],
        renderChart: (datasets) => (
            <PerfKernelDurationUtilizationChart
                datasets={datasets}
                maxCores={MAX_CORES}
                chartId={PerfChartId.MatmulUtilizationVsKernelDuration}
            />
        ),
        isDeviceTimeTrace: isAnyTrace,
        coordinate: 'x',
        axis: 'xaxis',
        axisTitle: KERNEL_DURATION_AXIS_TITLE,
        hoverText: 'Duration: %{x} ns',
    },
    {
        name: PERF_CHART_LABELS[PerfChartId.KernelDurationVsCoreCount],
        renderChart: (datasets) => <PerfDeviceKernelDurationChart datasets={datasets} />,
        isDeviceTimeTrace: isAnyTrace,
        coordinate: 'y',
        axis: 'yaxis',
        axisTitle: KERNEL_DURATION_AXIS_TITLE,
        hoverText: 'Device Kernel Duration: %{y} ns',
    },
    {
        name: PERF_CHART_LABELS[PerfChartId.CoreCountKernelRuntime],
        renderChart: (datasets) => <PerfDeviceKernelRuntimeChart datasets={datasets} />,
        isDeviceTimeTrace: (trace) => trace.yaxis === 'y2',
        coordinate: 'y',
        axis: 'yaxis2',
        axisTitle: KERNEL_DURATION_AXIS_TITLE,
        hoverText: 'Device Kernel Duration: %{y} ns',
    },
];

const DEVICE_TIME_CHART: DeviceTimeChart = {
    name: PERF_CHART_LABELS[PerfChartId.MatmulDeviceTime],
    renderChart: (datasets) => (
        <PerfDeviceTimeChart
            datasets={datasets}
            chartId={PerfChartId.MatmulDeviceTime}
        />
    ),
    isDeviceTimeTrace: isBar,
    coordinate: 'y',
    axis: 'yaxis',
    axisTitle: 'Time (ns)',
    hoverText: 'Device time: %{y} ns',
};

const ALL_CHARTS = [...KERNEL_DURATION_CHARTS, DEVICE_TIME_CHART];

const latestPlot = () => getPlotInstances().at(-1);
const layout = () => latestPlot()?.layout as Partial<Layout>;
const deviceTimeTraces = (chart: DeviceTimeChart) =>
    ((latestPlot()?.data ?? []) as Partial<PlotData>[]).filter(chart.isDeviceTimeTrace);

const renderChart = (chart: DeviceTimeChart, datasets: TypedPerfTableRow[][]) =>
    render(<TestProviders>{chart.renderChart(datasets)}</TestProviders>);

// Renders the charts one at a time, keyed by name so a failure lists every chart that disagrees.
const readEachChart = <Reading,>(
    datasets: TypedPerfTableRow[][],
    read: (chart: DeviceTimeChart, trace: Partial<PlotData>) => Reading,
): Record<string, Reading> =>
    Object.fromEntries(
        ALL_CHARTS.map((chart) => {
            renderChart(chart, datasets);
            const reading = read(chart, deviceTimeTraces(chart)[0]);

            cleanup();
            resetPlotPropsCapture();

            return [chart.name, reading];
        }),
    );

const unitInParentheses = (text: string | undefined) => text?.match(/\((\S+)\)$/)?.[1];
const unitAfterValue = (template: string | undefined, coordinate: DeviceTimeChart['coordinate']) =>
    template?.match(new RegExp(`%\\{${coordinate}\\} ([^\\s<]+)`))?.[1];

afterEach(() => {
    cleanup();
    resetPlotPropsCapture();
});

describe('device-time charts', () => {
    it.each(KERNEL_DURATION_CHARTS)("plot each report's device time in ns under ns labels on $name", (chart) => {
        renderChart(chart, TWO_REPORTS);

        const traces = deviceTimeTraces(chart);
        expect(traces.map((trace) => trace[chart.coordinate])).toEqual([[370_000, 12_500], [20_000]]);
        for (const trace of traces) {
            expect(trace.hovertemplate).toContain(chart.hoverText);
        }
        expect(layout()[chart.axis]?.title?.text).toBe(chart.axisTitle);
    });

    it('size the Device Kernel Duration + Utilization duration axis to the longest op in ns', () => {
        renderChart(KERNEL_DURATION_UTILIZATION_CHART, TWO_REPORTS);

        expect(layout().yaxis?.range).toEqual([0, 370_000]);
    });

    it('read one op as the same duration, in ns, on every chart that plots device time', () => {
        const readings = readEachChart([[row(370)]], (chart, trace) => ({
            duration: (trace[chart.coordinate] as number[])[0],
            axisUnit: unitInParentheses(layout()[chart.axis]?.title?.text),
            hoverUnit: unitAfterValue(trace.hovertemplate as string, chart.coordinate),
        }));

        expect(readings).toEqual(
            Object.fromEntries(
                ALL_CHARTS.map((chart) => [chart.name, { duration: 370_000, axisUnit: 'ns', hoverUnit: 'ns' }]),
            ),
        );
    });

    it('leave a gap for a missing device time, but a zero bar on Device Time + Ideal Time', () => {
        const durations = readEachChart(
            [[row(370), row(Number.NaN), row(null)]],
            (chart, trace) => trace[chart.coordinate],
        );

        expect(durations).toEqual({
            ...Object.fromEntries(KERNEL_DURATION_CHARTS.map((chart) => [chart.name, [370_000, null, null]])),
            [DEVICE_TIME_CHART.name]: [370_000, 0, 0],
        });
    });
});
