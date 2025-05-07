// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { PerfTableRow } from '../../definitions/PerfTable';
import getCoreUtilization from '../../functions/getCoreUtilization';
import PerfChart from './PerfChart';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';
import { getAxisUpperRange } from '../../functions/perfFunctions';
import getPlotLabel from '../../functions/getPlotLabel';
import { activePerformanceReportAtom, comparisonPerformanceReportAtom } from '../../store/app';
import { getPrimaryDataColours, getSecondaryDataColours } from '../../definitions/PerformancePlotColours';

interface PerfOperationKernelUtilizationChartProps {
    datasets?: PerfTableRow[][];
    maxCores: number;
}

function PerfOperationKernelUtilizationChart({ datasets = [], maxCores }: PerfOperationKernelUtilizationChartProps) {
    const perfReport = useAtomValue(activePerformanceReportAtom);
    const comparisonReport = useAtomValue(comparisonPerformanceReportAtom);

    const chartDataDuration = useMemo(
        () =>
            datasets.map((data, dataIndex) => ({
                x: data?.map((_row, index) => index + 1),
                y: data?.map((row) => row.device_time),
                type: 'bar',
                hovertemplate: `<b>%{data.name}</b><br />Operation: %{x}<br />Duration: %{y} ns<extra></extra>`,
                name: getPlotLabel(dataIndex, perfReport, comparisonReport),
                legendgroup: `group${dataIndex}`,
                marker: {
                    color: getPrimaryDataColours(dataIndex),
                },
            })) as Partial<PlotData>[],
        [datasets, perfReport, comparisonReport],
    );

    const chartDataUtilization = useMemo(
        () =>
            datasets.map((data, dataIndex) => ({
                x: data?.map((_row, index) => index + 1),
                y: data?.map((row) => getCoreUtilization(row, maxCores)).filter((value) => value !== -1) ?? [],
                yaxis: 'y2',
                hovertemplate: `<b>%{data.name}</b><br />Operation: %{x}<br />Utilization: %{y}<extra></extra>`,
                name: getPlotLabel(dataIndex, perfReport, comparisonReport),
                legendgroup: `group${dataIndex}`,
                marker: {
                    color: getSecondaryDataColours(dataIndex),
                },
            })) as Partial<PlotData>[],
        [datasets, maxCores, perfReport, comparisonReport],
    );

    const maxYValue = Math.max(...chartDataDuration.flatMap((data) => (data.y as number[]) ?? []));

    const configuration: PlotConfiguration = {
        margin: {
            l: 100,
            r: 0,
            b: 50,
            t: 0,
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
        yAxis2: {
            title: {
                text: 'Utilization (%)',
            },
            tickformat: '.0%',
            hoverformat: '.2%',
            range: [0, 1],
        },
    };

    return (
        <PerfChart
            title='Device Kernel Duration + Utilization'
            chartData={[...chartDataDuration, ...chartDataUtilization]}
            configuration={configuration}
        />
    );
}

export default PerfOperationKernelUtilizationChart;
