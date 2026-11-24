// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { TypedPerfTableRow } from '../../model/PerfTable';
import {
    PERF_CHART_WIDE_LEFT_MARGIN,
    PlotConfiguration,
    getCoreCountAxisConfig,
    getDeviceUtilizationAxisConfig,
} from '../../definitions/PlotConfigurations';
import { PERF_CHART_LABELS, PerfChartId } from '../../definitions/PerformanceCharts';
import PerfChart from './PerfChart';
import { activePerformanceReportAtom, comparisonPerformanceReportListAtom, mergeDevicesAtom } from '../../store/app';
import { getAxisUpperRange } from '../../functions/perfFunctions';
import {
    buildUtilisationTraces,
    getOperationHoverTemplate,
    getReportTraceFields,
} from '../../functions/perfChartTraces';
import { getPrimaryDataColours } from '../../definitions/PerformancePlotColours';
import PerfMultiDeviceNotice from './PerfMultiDeviceNotice';

interface PerfCoreCountUtilizationChartProps {
    datasets?: TypedPerfTableRow[][];
    maxCores: number;
    chartId: PerfChartId;
}

function PerfCoreCountUtilizationChart({ datasets = [], maxCores, chartId }: PerfCoreCountUtilizationChartProps) {
    const reportName = useAtomValue(activePerformanceReportAtom)?.reportName ?? null;
    const comparisonReportList = useAtomValue(comparisonPerformanceReportListAtom);
    const mergeDevices = useAtomValue(mergeDevicesAtom);

    const chartDataDuration = useMemo(
        () =>
            datasets.map((data, dataIndex) => ({
                ...getReportTraceFields(data, dataIndex, { reportName, comparisonReportList }),
                y: data.map((row) => row.cores),
                type: 'bar',
                hovertemplate: getOperationHoverTemplate('Cores: %{y}'),
                marker: {
                    color: getPrimaryDataColours(dataIndex),
                },
            })) as Partial<PlotData>[],
        [datasets, reportName, comparisonReportList],
    );

    const { traces: chartDataUtilization, maxValue: maxY2Value } = useMemo(
        () => buildUtilisationTraces(datasets, maxCores, { reportName, comparisonReportList }),
        [datasets, reportName, comparisonReportList, maxCores],
    );

    const chartData = useMemo(
        () => [...chartDataDuration, ...chartDataUtilization],
        [chartDataDuration, chartDataUtilization],
    );

    // Memoized because PerfChart derives the Plotly layout from it, and a fresh object redraws
    // the chart — and re-reads the chart chrome from the stylesheet — on every render.
    const configuration = useMemo<PlotConfiguration>(
        () => ({
            margin: PERF_CHART_WIDE_LEFT_MARGIN,
            showLegend: true,
            xAxis: {
                title: { text: 'Operation' },
                range: [0, getAxisUpperRange(datasets)],
            },
            yAxis: getCoreCountAxisConfig(maxCores),
            yAxis2: getDeviceUtilizationAxisConfig(maxY2Value),
        }),
        [datasets, maxCores, maxY2Value],
    );

    return (
        <>
            {maxY2Value > 0 && mergeDevices && <PerfMultiDeviceNotice />}
            <PerfChart
                id={chartId}
                title={PERF_CHART_LABELS[chartId]}
                chartData={chartData}
                configuration={configuration}
            />
        </>
    );
}

export default PerfCoreCountUtilizationChart;
