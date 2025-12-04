// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { TypedPerfTableRow } from '../../definitions/PerfTable';
import getCoreUtilization from '../../functions/getCoreUtilization';
import { PlotConfiguration, getDeviceUtilizationAxisConfig } from '../../definitions/PlotConfigurations';
import PerfChart from './PerfChart';
import getPlotLabel from '../../functions/getPlotLabel';
import { activePerformanceReportAtom, comparisonPerformanceReportListAtom, noMergeDevicesAtom } from '../../store/app';
import { getPrimaryDataColours } from '../../definitions/PerformancePlotColours';
import PerfMultiDeviceNotice from './PerfMultiDeviceNotice';

interface PerfKernelDurationUtilizationChartProps {
    datasets: TypedPerfTableRow[][];
    maxCores: number;
}

function PerfKernelDurationUtilizationChart({ datasets, maxCores }: PerfKernelDurationUtilizationChartProps) {
    const perfReport = useAtomValue(activePerformanceReportAtom);
    const comparisonReportList = useAtomValue(comparisonPerformanceReportListAtom);
    const noMergeDevices = useAtomValue(noMergeDevicesAtom);

    const chartData = useMemo(
        () =>
            datasets.map((data, dataIndex) => ({
                x: data?.map((row) => row.device_time),
                y: data?.map((row) => getCoreUtilization(row, maxCores)).filter((value) => value !== -1),
                mode: 'markers',
                type: 'scatter',
                name: getPlotLabel(dataIndex, perfReport?.reportName, comparisonReportList),
                marker: {
                    size: 10,
                    color: getPrimaryDataColours(dataIndex),
                },
                hovertemplate: `Duration: %{x} ns<br />Utilization: %{y}`,
            })) as Partial<PlotData>[],
        [datasets, maxCores, perfReport, comparisonReportList],
    );

    const maxYValue = Math.max(...chartData.flatMap((data) => (data.y as number[]) ?? []));

    const configuration: PlotConfiguration = {
        showLegend: true,
        xAxis: {
            title: {
                text: 'Device Kernel Duration (ns)',
            },
            tickformat: 'd',
            hoverformat: ',.2r',
        },
        yAxis: getDeviceUtilizationAxisConfig(maxYValue),
    };

    return (
        <>
            {maxYValue > 1 && !noMergeDevices && <PerfMultiDeviceNotice />}
            <PerfChart
                title='Utilization vs Device Kernel Duration'
                chartData={chartData}
                configuration={configuration}
            />
        </>
    );
}

export default PerfKernelDurationUtilizationChart;
