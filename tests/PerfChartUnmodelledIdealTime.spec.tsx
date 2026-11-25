// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import type { Layout, PlotData } from 'plotly.js';
import type { ReactElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getPlotInstances, resetPlotPropsCapture } from './mocks/plotComponent';
import PerfCoreCountUtilizationChart from '../src/components/performance/PerfCoreCountUtilizationChart';
import PerfDeviceTimeChart from '../src/components/performance/PerfDeviceTimeChart';
import PerfKernelDurationUtilizationChart from '../src/components/performance/PerfKernelDurationUtilizationChart';
import PerfOperationKernelUtilizationChart from '../src/components/performance/PerfOperationKernelUtilizationChart';
import { PerfChartId } from '../src/definitions/PerformanceCharts';
import { getSecondaryDataColours } from '../src/definitions/PerformancePlotColours';
import { OpType } from '../src/definitions/Performance';
import { TypedPerfTableRow } from '../src/model/PerfTable';
import { activePerformanceReportAtom, comparisonPerformanceReportListAtom, mergeDevicesAtom } from '../src/store/app';
import { AtomProviderInitialValues } from './helpers/atomProvider';
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
const NAMED_REPORTS: AtomProviderInitialValues = [
    [activePerformanceReportAtom, { reportName: 'Base', path: '/base' }],
    [comparisonPerformanceReportListAtom, ['Other']],
];

type OpUtilisationChart = typeof PerfCoreCountUtilizationChart;

// Both charts that plot utilisation per op gate the merged-devices notice on a known utilisation.
const OP_UTILISATION_CHARTS: [string, OpUtilisationChart, PerfChartId][] = [
    ['Core Count + Utilization', PerfCoreCountUtilizationChart, PerfChartId.MatmulCoreCountUtilization],
    ['Kernel Duration + Utilization', PerfOperationKernelUtilizationChart, PerfChartId.MatmulKernelDurationUtilization],
];

const renderWithDevicesMerged = (Chart: OpUtilisationChart, chartId: PerfChartId, rows: TypedPerfTableRow[]) =>
    render(
        <TestProviders initialAtomValues={[[mergeDevicesAtom, true]]}>
            <Chart
                datasets={[rows]}
                maxCores={MAX_CORES}
                chartId={chartId}
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

    it('size the Utilization vs Kernel Duration axis to the largest utilisation of every report', () => {
        render(
            <TestProviders>
                <PerfKernelDurationUtilizationChart
                    datasets={[[row()], [row({ pm_ideal_ns: 20_000 })]]}
                    maxCores={MAX_CORES}
                    chartId={PerfChartId.MatmulUtilizationVsKernelDuration}
                />
            </TestProviders>,
        );

        expect(traces().map((trace) => trace.y)).toEqual([[0.5], [2]]);
        expect(layout().yaxis?.range?.[1]).toBeCloseTo(2.2);
    });

    it('name each Utilization vs Kernel Duration trace after its report', () => {
        render(
            <TestProviders initialAtomValues={NAMED_REPORTS}>
                <PerfKernelDurationUtilizationChart
                    datasets={[[row()], [row()]]}
                    maxCores={MAX_CORES}
                    chartId={PerfChartId.MatmulUtilizationVsKernelDuration}
                />
            </TestProviders>,
        );

        expect(traces().map((trace) => trace.name)).toEqual(['Base', 'Other']);
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

    it.each(OP_UTILISATION_CHARTS)(
        'hide the merged-devices notice on %s when no utilisation is known',
        (_, Chart, chartId) => {
            renderWithDevicesMerged(Chart, chartId, [row({ pm_ideal_ns: 1 }), row({ pm_ideal_ns: 1 })]);

            expect(screen.queryByText(MERGED_DEVICES_NOTICE)).not.toBeInTheDocument();
        },
    );

    it.each(OP_UTILISATION_CHARTS)(
        'show the merged-devices notice on %s once a utilisation is known',
        (_, Chart, chartId) => {
            renderWithDevicesMerged(Chart, chartId, [row(), row()]);

            expect(screen.getByText(MERGED_DEVICES_NOTICE)).toBeInTheDocument();
        },
    );

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
        expect(idealTimes.hovertemplate).toContain('Ideal time: %{y} ns');
        expect(isolatedIdealTimes).toMatchObject({ ...ISOLATED_MARKERS, y: [IDEAL_NS] });
        expect([idealTimes.yaxis, isolatedIdealTimes.yaxis]).toEqual([undefined, undefined]);
    });

    it("groups and colours each report's markers with its own line in comparison mode", () => {
        render(
            <TestProviders>
                <PerfDeviceTimeChart
                    datasets={[ROWS, ROWS]}
                    chartId={PerfChartId.MatmulDeviceTime}
                />
            </TestProviders>,
        );

        expect(traces().filter(isMarkersOnly)).toMatchObject(
            [0, 1].map((dataIndex) => ({
                ...ISOLATED_MARKERS,
                y: [IDEAL_NS],
                legendgroup: `group${dataIndex}`,
                marker: { color: getSecondaryDataColours(dataIndex) },
            })),
        );
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

    it.each<[string, TypedPerfTableRow[][], number]>([
        ['one report', [[row({ pm_ideal_ns: 20_000, device_time: 10 })]], 20_000],
        ['the second report in comparison mode', [[row()], [row({ pm_ideal_ns: 30_000 })]], 30_000],
    ])('sizes the time axis to an ideal time above every device time, from %s', (_, datasets, maxIdealTime) => {
        render(
            <TestProviders>
                <PerfDeviceTimeChart
                    datasets={datasets}
                    chartId={PerfChartId.MatmulDeviceTime}
                />
            </TestProviders>,
        );

        expect(layout().yaxis?.range).toEqual([0, maxIdealTime]);
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

describe('bar and line charts', () => {
    const HOVER_TITLE = /^<b>%\{data\.name\}<\/b><br \/>Operation: %\{x\}<br \/>/;
    const pairing = ({ x, name, legendgroup }: Partial<PlotData>) => ({ x, name, legendgroup });

    it.each<[string, (datasets: TypedPerfTableRow[][]) => ReactElement]>([
        [
            'Core Count + Utilization',
            (datasets) => (
                <PerfCoreCountUtilizationChart
                    datasets={datasets}
                    maxCores={MAX_CORES}
                    chartId={PerfChartId.MatmulCoreCountUtilization}
                />
            ),
        ],
        [
            'Kernel Duration + Utilization',
            (datasets) => (
                <PerfOperationKernelUtilizationChart
                    datasets={datasets}
                    maxCores={MAX_CORES}
                    chartId={PerfChartId.MatmulKernelDurationUtilization}
                />
            ),
        ],
        [
            'Device Time + Ideal Time',
            (datasets) => (
                <PerfDeviceTimeChart
                    datasets={datasets}
                    chartId={PerfChartId.MatmulDeviceTime}
                />
            ),
        ],
    ])("pair each report's bars and line in %s", (_, renderChart) => {
        render(
            <TestProviders initialAtomValues={NAMED_REPORTS}>
                {renderChart([
                    [row(), row()],
                    [row(), row()],
                ])}
            </TestProviders>,
        );

        const bars = traces().filter((trace) => trace.type === 'bar');
        const lines = traces().filter((trace) => trace.type !== 'bar' && !isMarkersOnly(trace));

        expect(bars.map(pairing)).toEqual([
            { x: [1, 2], name: 'Base', legendgroup: 'group0' },
            { x: [1, 2], name: 'Other', legendgroup: 'group1' },
        ]);
        expect(lines.map(pairing)).toEqual(bars.map(pairing));
        for (const trace of [...bars, ...lines]) {
            expect(trace.hovertemplate).toMatch(HOVER_TITLE);
        }
    });
});
