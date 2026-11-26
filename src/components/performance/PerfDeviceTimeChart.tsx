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
import { getAxisUpperRange } from '../../functions/perfFunctions';
import {
    buildSecondaryLineTraces,
    getOperationHoverTemplate,
    getReportTraceFields,
} from '../../functions/perfChartTraces';
import { getMaxValue } from '../../functions/numericExtent';
import getDeviceTimeNs from '../../functions/getDeviceTimeNs';
import isUnmodelledIdealTime from '../../functions/isUnmodelledIdealTime';
import { getPrimaryDataColours } from '../../definitions/PerformancePlotColours';

const getDeviceTimeNsOrZero = (row: TypedPerfTableRow): number => getDeviceTimeNs(row) ?? 0;

const getModelledIdealTime = ({ pm_ideal_ns: idealNs }: TypedPerfTableRow): number | null =>
    isUnmodelledIdealTime(idealNs) ? null : idealNs;

interface PerfDeviceTimeChartProps {
    datasets?: TypedPerfTableRow[][];
    chartId: PerfChartId;
}

function PerfDeviceTimeChart({ datasets = [], chartId }: PerfDeviceTimeChartProps) {
    const reportName = useAtomValue(activePerformanceReportAtom)?.reportName ?? null;
    const comparisonReportList = useAtomValue(comparisonPerformanceReportListAtom);

    const deviceTimes = useMemo(
        () =>
            datasets.map((data, dataIndex) => ({
                ...getReportTraceFields(data, dataIndex, { reportName, comparisonReportList }),
                y: data.map(getDeviceTimeNsOrZero),
                type: 'bar',
                hovertemplate: getOperationHoverTemplate('Device time: %{y} ns'),
                marker: {
                    color: getPrimaryDataColours(dataIndex),
                },
            })) as Partial<PlotData>[],
        [datasets, reportName, comparisonReportList],
    );

    const { traces: idealTimes, maxValue: maxIdealTime } = useMemo(
        () =>
            buildSecondaryLineTraces(datasets, getModelledIdealTime, {
                valueHoverTemplate: 'Ideal time: %{y} ns',
                reportName,
                comparisonReportList,
            }),
        [datasets, reportName, comparisonReportList],
    );

    const chartData = useMemo(() => [...deviceTimes, ...idealTimes], [deviceTimes, idealTimes]);

    // Memoized because PerfChart derives the Plotly layout from it, and a fresh object redraws
    // the chart — and re-reads the chart chrome from the stylesheet — on every render.
    const configuration = useMemo<PlotConfiguration>(() => {
        const maxDeviceTime = getMaxValue(datasets.flatMap((data) => data.map(getDeviceTimeNsOrZero)));

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
