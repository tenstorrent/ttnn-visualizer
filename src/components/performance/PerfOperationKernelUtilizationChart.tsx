// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { TypedPerfTableRow } from '../../model/PerfTable';
import PerfChart from './PerfChart';
import {
    PlotConfiguration,
    getDeviceUtilizationAxisConfig,
    getNsAxisConfig,
} from '../../definitions/PlotConfigurations';
import { PERF_CHART_LABELS, PerfChartId } from '../../definitions/PerformanceCharts';
import { getAxisUpperRange } from '../../functions/perfFunctions';
import {
    buildUtilisationTraces,
    getOperationHoverTemplate,
    getReportTraceFields,
} from '../../functions/perfChartTraces';
import { activePerformanceReportAtom, comparisonPerformanceReportListAtom, mergeDevicesAtom } from '../../store/app';
import { getPrimaryDataColours } from '../../definitions/PerformancePlotColours';
import PerfMultiDeviceNotice from './PerfMultiDeviceNotice';
import { getMaxValue } from '../../functions/numericExtent';

interface PerfOperationKernelUtilizationChartProps {
    datasets?: TypedPerfTableRow[][];
    maxCores: number;
    chartId: PerfChartId;
}

function PerfOperationKernelUtilizationChart({
    datasets = [],
    maxCores,
    chartId,
}: PerfOperationKernelUtilizationChartProps) {
    const reportName = useAtomValue(activePerformanceReportAtom)?.reportName ?? null;
    const comparisonReportList = useAtomValue(comparisonPerformanceReportListAtom);
    const mergeDevices = useAtomValue(mergeDevicesAtom);

    const chartDataDuration = useMemo(
        () =>
            datasets.map((data, dataIndex) => ({
                ...getReportTraceFields(data, dataIndex, { reportName, comparisonReportList }),
                y: data.map((row) => row.device_time),
                type: 'bar',
                hovertemplate: getOperationHoverTemplate('Duration: %{y} ns'),
                marker: {
                    color: getPrimaryDataColours(dataIndex),
                },
            })) as Partial<PlotData>[],
        [datasets, reportName, comparisonReportList],
    );

    const { traces: chartDataUtilization, maxValue: maxY2Value } = useMemo(
        () => buildUtilisationTraces(datasets, maxCores, { reportName, comparisonReportList }),
        [datasets, maxCores, reportName, comparisonReportList],
    );

    const maxYValue = getMaxValue(chartDataDuration.flatMap((data) => (data.y as number[]) ?? []));

    const configuration: PlotConfiguration = {
        margin: {
            l: 100,
            r: 50,
            b: 50,
            t: 10,
        },
        showLegend: true,
        xAxis: {
            range: [0, getAxisUpperRange(datasets)],
            title: {
                text: 'Operation',
            },
        },
        yAxis: getNsAxisConfig('Device Kernel Duration (ns)', {
            range: [0, maxYValue],
        }),
        yAxis2: getDeviceUtilizationAxisConfig(maxY2Value),
    };

    return (
        <>
            {maxY2Value > 0 && mergeDevices && <PerfMultiDeviceNotice />}
            <PerfChart
                id={chartId}
                title={PERF_CHART_LABELS[chartId]}
                chartData={[...chartDataDuration, ...chartDataUtilization]}
                configuration={configuration}
            />
        </>
    );
}

export default PerfOperationKernelUtilizationChart;
