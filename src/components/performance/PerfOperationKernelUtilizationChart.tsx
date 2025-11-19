// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { TypedPerfTableRow } from '../../definitions/PerfTable';
import getCoreUtilization from '../../functions/getCoreUtilization';
import PerfChart from './PerfChart';
import { PlotConfiguration, getDeviceUtilizationAxisConfig } from '../../definitions/PlotConfigurations';
import { getAxisUpperRange } from '../../functions/perfFunctions';
import getPlotLabel from '../../functions/getPlotLabel';
import { activePerformanceReportAtom, comparisonPerformanceReportListAtom } from '../../store/app';
import { getPrimaryDataColours, getSecondaryDataColours } from '../../definitions/PerformancePlotColours';
import PerfMultiDeviceNotice from './PerfMultiDeviceNotice';

interface PerfOperationKernelUtilizationChartProps {
    datasets?: TypedPerfTableRow[][];
    maxCores: number;
}

function PerfOperationKernelUtilizationChart({ datasets = [], maxCores }: PerfOperationKernelUtilizationChartProps) {
    const perfReport = useAtomValue(activePerformanceReportAtom);
    const comparisonReportList = useAtomValue(comparisonPerformanceReportListAtom);

    const chartDataDuration = useMemo(
        () =>
            datasets.map((data, dataIndex) => ({
                x: data?.map((_row, index) => index + 1),
                y: data?.map((row) => row.device_time),
                type: 'bar',
                hovertemplate: `<b>%{data.name}</b><br />Operation: %{x}<br />Duration: %{y} ns<extra></extra>`,
                name: getPlotLabel(dataIndex, perfReport?.reportName, comparisonReportList),
                legendgroup: `group${dataIndex}`,
                marker: {
                    color: getPrimaryDataColours(dataIndex),
                },
            })) as Partial<PlotData>[],
        [datasets, perfReport, comparisonReportList],
    );

    const chartDataUtilization = useMemo(
        () =>
            datasets.map((data, dataIndex) => ({
                x: data?.map((_row, index) => index + 1),
                y: data?.map((row) => getCoreUtilization(row, maxCores)).filter((value) => value !== -1) ?? [],
                yaxis: 'y2',
                hovertemplate: `<b>%{data.name}</b><br />Operation: %{x}<br />Utilization: %{y}<extra></extra>`,
                name: getPlotLabel(dataIndex, perfReport?.reportName, comparisonReportList),
                legendgroup: `group${dataIndex}`,
                marker: {
                    color: getSecondaryDataColours(dataIndex),
                },
            })) as Partial<PlotData>[],
        [datasets, maxCores, perfReport, comparisonReportList],
    );

    const maxYValue = Math.max(...chartDataDuration.flatMap((data) => (data.y as number[]) ?? []));
    const maxY2Value = Math.max(...chartDataUtilization.flatMap((data) => (data.y as number[]) ?? []));

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
        yAxis: {
            title: {
                text: 'Device Kernel Duration (ns)',
            },
            tickformat: 'd',
            hoverformat: ',.2r',
            range: [0, maxYValue],
        },
        yAxis2: getDeviceUtilizationAxisConfig(maxY2Value),
    };

    return (
        <>
            {maxY2Value > 1 && <PerfMultiDeviceNotice />}
            <PerfChart
                title='Device Kernel Duration + Utilization'
                chartData={[...chartDataDuration, ...chartDataUtilization]}
                configuration={configuration}
            />
        </>
    );
}

export default PerfOperationKernelUtilizationChart;
