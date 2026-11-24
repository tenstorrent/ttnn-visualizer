// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { TypedPerfTableRow } from '../../model/PerfTable';
import { PERF_CHART_WIDE_LEFT_MARGIN, PlotConfiguration, getNsAxisConfig } from '../../definitions/PlotConfigurations';
import { PERF_CHART_LABELS, PerfChartId } from '../../definitions/PerformanceCharts';
import PerfChart from './PerfChart';
import { activePerformanceReportAtom, comparisonPerformanceReportListAtom } from '../../store/app';
import getPlotLabel from '../../functions/getPlotLabel';
import { getAxisUpperRange } from '../../functions/perfFunctions';
import { buildSecondaryLineTraces } from '../../functions/perfChartTraces';
import { getMaxValue } from '../../functions/numericExtent';
import isUnmodelledIdealTime from '../../functions/isUnmodelledIdealTime';
import { getPrimaryDataColours } from '../../definitions/PerformancePlotColours';

const getModelledIdealTime = ({ pm_ideal_ns: idealNs }: TypedPerfTableRow): number | null =>
    isUnmodelledIdealTime(idealNs) ? null : idealNs;

interface PerfDeviceTimeChartProps {
    datasets?: TypedPerfTableRow[][];
    chartId: PerfChartId;
}

function PerfDeviceTimeChart({ datasets = [], chartId }: PerfDeviceTimeChartProps) {
    const perfReport = useAtomValue(activePerformanceReportAtom);
    const comparisonReportList = useAtomValue(comparisonPerformanceReportListAtom);

    const deviceTimes = useMemo(
        () =>
            datasets.map((data, dataIndex) => ({
                x: data?.map((_row, index) => index + 1),
                y: data?.map((row) => (row.device_time ? row.device_time * 1000 : 0)), // Convert microseconds to nanoseconds
                type: 'bar',
                hovertemplate: `<b>%{data.name}</b><br />Operation: %{x}<br />Device time: %{y} ns<extra></extra>`,
                name: getPlotLabel(dataIndex, perfReport?.reportName, comparisonReportList),
                legendgroup: `group${dataIndex}`,
                marker: {
                    color: getPrimaryDataColours(dataIndex),
                },
            })) as Partial<PlotData>[],
        [datasets, perfReport, comparisonReportList],
    );

    const { traces: idealTimes, maxValue: maxIdealTime } = useMemo(
        () =>
            buildSecondaryLineTraces(
                datasets,
                getModelledIdealTime,
                { valueHoverTemplate: 'Ideal time: %{y} ns' },
                perfReport?.reportName ?? null,
                comparisonReportList,
            ),
        [datasets, perfReport, comparisonReportList],
    );

    const chartData = useMemo(() => [...deviceTimes, ...idealTimes], [deviceTimes, idealTimes]);

    // Memoized because PerfChart derives the Plotly layout from it, and a fresh object redraws
    // the chart — and re-reads the chart chrome from the stylesheet — on every render.
    const configuration = useMemo<PlotConfiguration>(() => {
        const maxDeviceTime = getMaxValue(
            datasets.flatMap((data) => data.map((row) => (row.device_time ? row.device_time * 1000 : 0))),
        ); // Convert microseconds to nanoseconds

        return {
            margin: PERF_CHART_WIDE_LEFT_MARGIN,
            showLegend: true,
            xAxis: {
                title: { text: 'Operation' },
                range: [0, getAxisUpperRange(datasets)],
            },
            yAxis: getNsAxisConfig('Time (ns)', {
                range: [0, Math.max(maxDeviceTime, maxIdealTime)],
            }),
        };
    }, [datasets, maxIdealTime]);

    return (
        <PerfChart
            id={chartId}
            title={PERF_CHART_LABELS[chartId]}
            chartData={chartData}
            configuration={configuration}
        />
    );
}

export default PerfDeviceTimeChart;
