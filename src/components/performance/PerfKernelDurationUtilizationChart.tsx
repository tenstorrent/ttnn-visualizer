// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { TypedPerfTableRow } from '../../model/PerfTable';
import getCoreUtilization from '../../functions/getCoreUtilization';
import getDeviceTimeNs from '../../functions/getDeviceTimeNs';
import {
    PlotConfiguration,
    getDeviceUtilizationAxisConfig,
    getNsAxisConfig,
} from '../../definitions/PlotConfigurations';
import { PERF_CHART_LABELS, PerfChartId } from '../../definitions/PerformanceCharts';
import PerfChart from './PerfChart';
import getPlotLabel from '../../functions/getPlotLabel';
import { activePerformanceReportAtom, comparisonPerformanceReportListAtom, mergeDevicesAtom } from '../../store/app';
import { getPrimaryDataColours } from '../../definitions/PerformancePlotColours';
import PerfMultiDeviceNotice from './PerfMultiDeviceNotice';
import { getMaxFiniteValue, getMaxValue } from '../../functions/numericExtent';

interface PerfKernelDurationUtilizationChartProps {
    datasets: TypedPerfTableRow[][];
    maxCores: number;
    chartId: PerfChartId;
}

function PerfKernelDurationUtilizationChart({ datasets, maxCores, chartId }: PerfKernelDurationUtilizationChartProps) {
    const reportName = useAtomValue(activePerformanceReportAtom)?.reportName ?? null;
    const comparisonReportList = useAtomValue(comparisonPerformanceReportListAtom);
    const mergeDevices = useAtomValue(mergeDevicesAtom);

    const chartData = useMemo(
        () =>
            datasets.map((data, dataIndex) => ({
                x: data?.map(getDeviceTimeNs),
                y: data?.map((row) => getCoreUtilization(row, maxCores)),
                mode: 'markers',
                type: 'scatter',
                name: getPlotLabel(dataIndex, reportName, comparisonReportList) ?? undefined,
                marker: {
                    size: 10,
                    color: getPrimaryDataColours(dataIndex),
                },
                hovertemplate: `Duration: %{x} ns<br />Utilization: %{y}`,
            })) as Partial<PlotData>[],
        [datasets, maxCores, reportName, comparisonReportList],
    );

    const maxYValue = useMemo(
        () => getMaxValue(chartData.map((trace) => getMaxFiniteValue((trace.y as (number | null)[]) ?? []))),
        [chartData],
    );

    const configuration: PlotConfiguration = {
        showLegend: true,
        xAxis: getNsAxisConfig('Device Kernel Duration (ns)'),
        yAxis: getDeviceUtilizationAxisConfig(maxYValue),
    };

    return (
        <>
            {maxYValue > 0 && mergeDevices && <PerfMultiDeviceNotice />}
            <PerfChart
                id={chartId}
                title={PERF_CHART_LABELS[chartId]}
                chartData={chartData}
                configuration={configuration}
            />
        </>
    );
}

export default PerfKernelDurationUtilizationChart;
