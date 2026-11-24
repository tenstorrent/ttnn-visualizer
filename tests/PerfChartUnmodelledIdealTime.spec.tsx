// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import type { Layout, PlotData } from 'plotly.js';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getPlotInstances, resetPlotPropsCapture } from './mocks/plotComponent';
import PerfCoreCountUtilizationChart from '../src/components/performance/PerfCoreCountUtilizationChart';
import PerfDeviceTimeChart from '../src/components/performance/PerfDeviceTimeChart';
import PerfKernelDurationUtilizationChart from '../src/components/performance/PerfKernelDurationUtilizationChart';
import PerfOperationKernelUtilizationChart from '../src/components/performance/PerfOperationKernelUtilizationChart';
import { PerfChartId } from '../src/definitions/PerformanceCharts';
import { OpType } from '../src/definitions/Performance';
import { TypedPerfTableRow } from '../src/model/PerfTable';
import { mergeDevicesAtom } from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';

const MAX_CORES = 64;
const IDEAL_NS = 5_000;

// 5 µs of a 10 µs op on every core: a utilisation of 0.5.
const row = (overrides: Partial<TypedPerfTableRow> = {}): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        op_code: 'Matmul',
        raw_op_code: 'Matmul',
        pm_ideal_ns: IDEAL_NS,
        device_time: 10,
        cores: 64,
        available_cores: null,
        advice: [],
        bound: null,
        isFirstHashOccurrence: true,
        id: 1,
        ...overrides,
    }) as unknown as TypedPerfTableRow;

// A modelled op between two the perf model leaves out, then one with no ideal time at all.
const ROWS = [row({ pm_ideal_ns: 1 }), row(), row({ pm_ideal_ns: 1 }), row({ pm_ideal_ns: null })];
const OPERATIONS = [1, 2, 3, 4];

const latestPlot = () => getPlotInstances().at(-1);
const traces = () => (latestPlot()?.data ?? []) as Partial<PlotData>[];
const layout = () => latestPlot()?.layout as Partial<Layout>;
const isMarkersOnly = (trace: Partial<PlotData>) => trace.mode === 'markers';
const lineOnY2 = () => traces().find((trace) => trace.yaxis === 'y2' && !isMarkersOnly(trace));
const markersOnY2 = () => traces().filter((trace) => trace.yaxis === 'y2' && isMarkersOnly(trace));

// Only the second op has a value with no neighbour, so it alone needs a marker.
const ISOLATED_MARKERS = { x: [2], mode: 'markers', showlegend: false, hoverinfo: 'skip' };
const MERGED_DEVICES_NOTICE = /Multi device operations are merged/;

const renderWithDevicesMerged = (rows: TypedPerfTableRow[]) =>
    render(
        <TestProviders initialAtomValues={[[mergeDevicesAtom, true]]}>
            <PerfCoreCountUtilizationChart
                datasets={[rows]}
                maxCores={MAX_CORES}
                chartId={PerfChartId.MatmulCoreCountUtilization}
            />
        </TestProviders>,
    );

afterEach(() => {
    cleanup();
    resetPlotPropsCapture();
});

describe('utilisation charts', () => {
    it('leave an unknown utilisation out of Core Count + Utilization, against its own op', () => {
        render(
            <TestProviders>
                <PerfCoreCountUtilizationChart
                    datasets={[ROWS]}
                    maxCores={MAX_CORES}
                    chartId={PerfChartId.MatmulCoreCountUtilization}
                />
            </TestProviders>,
        );

        expect(lineOnY2()?.x).toEqual(OPERATIONS);
        expect(lineOnY2()?.y).toEqual([null, 0.5, null, null]);
        expect(lineOnY2()?.mode).toBeUndefined();
        expect(markersOnY2()).toMatchObject([{ ...ISOLATED_MARKERS, y: [0.5], yaxis: 'y2' }]);
        expect(layout().yaxis2?.range).toEqual([0, 1.1]);
    });

    it('leave an unknown utilisation out of Kernel Duration + Utilization, against its own op', () => {
        render(
            <TestProviders>
                <PerfOperationKernelUtilizationChart
                    datasets={[ROWS]}
                    maxCores={MAX_CORES}
                    chartId={PerfChartId.MatmulKernelDurationUtilization}
                />
            </TestProviders>,
        );

        expect(lineOnY2()?.x).toEqual(OPERATIONS);
        expect(lineOnY2()?.y).toEqual([null, 0.5, null, null]);
        expect(lineOnY2()?.mode).toBeUndefined();
        expect(markersOnY2()).toMatchObject([{ ...ISOLATED_MARKERS, y: [0.5], yaxis: 'y2' }]);
    });

    it('leave an unknown utilisation out of Utilization vs Kernel Duration', () => {
        render(
            <TestProviders>
                <PerfKernelDurationUtilizationChart
                    datasets={[ROWS]}
                    maxCores={MAX_CORES}
                    chartId={PerfChartId.MatmulUtilizationVsKernelDuration}
                />
            </TestProviders>,
        );

        const [scatter] = traces();
        expect(scatter.x).toEqual([10, 10, 10, 10]);
        expect(scatter.y).toEqual([null, 0.5, null, null]);
        expect(layout().yaxis?.range).toEqual([0, 1.1]);
    });

    it('add no markers when every utilisation is known', () => {
        render(
            <TestProviders>
                <PerfCoreCountUtilizationChart
                    datasets={[[row(), row()]]}
                    maxCores={MAX_CORES}
                    chartId={PerfChartId.MatmulCoreCountUtilization}
                />
            </TestProviders>,
        );

        expect(lineOnY2()?.y).toEqual([0.5, 0.5]);
        expect(lineOnY2()?.mode).toBeUndefined();
        expect(markersOnY2()).toEqual([]);
    });

    it('mark only the gapped report’s value in comparison mode', () => {
        render(
            <TestProviders>
                <PerfCoreCountUtilizationChart
                    datasets={[ROWS, [row(), row()]]}
                    maxCores={MAX_CORES}
                    chartId={PerfChartId.MatmulCoreCountUtilization}
                />
            </TestProviders>,
        );

        const lines = traces().filter((trace) => trace.yaxis === 'y2' && !isMarkersOnly(trace));
        expect(lines.map((trace) => trace.mode)).toEqual([undefined, undefined]);
        expect(markersOnY2()).toMatchObject([{ ...ISOLATED_MARKERS, legendgroup: 'group0' }]);
    });

    it('hide the merged-devices notice when no utilisation is known', () => {
        renderWithDevicesMerged([row({ pm_ideal_ns: 1 }), row({ pm_ideal_ns: 1 })]);

        expect(screen.queryByText(MERGED_DEVICES_NOTICE)).not.toBeInTheDocument();
    });

    it('show the merged-devices notice once a utilisation is known', () => {
        renderWithDevicesMerged([row(), row()]);

        expect(screen.getByText(MERGED_DEVICES_NOTICE)).toBeInTheDocument();
    });

    it('leave every value out when no utilisation is known, with no markers', () => {
        render(
            <TestProviders>
                <PerfCoreCountUtilizationChart
                    datasets={[[row({ pm_ideal_ns: 1 }), row({ pm_ideal_ns: 1 })]]}
                    maxCores={MAX_CORES}
                    chartId={PerfChartId.MatmulCoreCountUtilization}
                />
            </TestProviders>,
        );

        expect(lineOnY2()?.y).toEqual([null, null]);
        expect(markersOnY2()).toEqual([]);
        expect(layout().yaxis2?.range).toEqual([0, 1.1]);
    });
});

describe('Device Time + Ideal Time', () => {
    it('leaves the perf model placeholder out of the ideal-time series, against its own op', () => {
        render(
            <TestProviders>
                <PerfDeviceTimeChart
                    datasets={[ROWS]}
                    chartId={PerfChartId.MatmulDeviceTime}
                />
            </TestProviders>,
        );

        const [, idealTimes, isolatedIdealTimes] = traces();
        expect(idealTimes.x).toEqual(OPERATIONS);
        expect(idealTimes.y).toEqual([null, IDEAL_NS, null, null]);
        expect(idealTimes.mode).toBeUndefined();
        expect(isolatedIdealTimes).toMatchObject({ ...ISOLATED_MARKERS, y: [IDEAL_NS] });
    });

    it('sizes the time axis without the placeholder', () => {
        render(
            <TestProviders>
                <PerfDeviceTimeChart
                    datasets={[[row({ pm_ideal_ns: 1, device_time: 0.0005 })]]}
                    chartId={PerfChartId.MatmulDeviceTime}
                />
            </TestProviders>,
        );

        expect(layout().yaxis?.range).toEqual([0, 0.5]);
    });

    it('keeps every modelled ideal time', () => {
        render(
            <TestProviders>
                <PerfDeviceTimeChart
                    datasets={[[row({ pm_ideal_ns: 2 }), row()]]}
                    chartId={PerfChartId.MatmulDeviceTime}
                />
            </TestProviders>,
        );

        expect(traces()).toHaveLength(2);
        const [, idealTimes] = traces();
        expect(idealTimes.y).toEqual([2, IDEAL_NS]);
        expect(idealTimes.mode).toBeUndefined();
    });
});
