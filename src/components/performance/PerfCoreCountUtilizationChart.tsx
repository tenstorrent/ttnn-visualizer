// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { TypedPerfTableRow } from '../../definitions/PerfTable';
import getCoreUtilization from '../../functions/getCoreUtilization';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';
import PerfChart from './PerfChart';
import { activePerformanceReportAtom, comparisonPerformanceReportListAtom } from '../../store/app';
import getPlotLabel from '../../functions/getPlotLabel';
import { getAxisUpperRange } from '../../functions/perfFunctions';
import { getPrimaryDataColours, getSecondaryDataColours } from '../../definitions/PerformancePlotColours';
import PerfMultiDeviceNotice from './PerfMultiDeviceNotice';

interface PerfCoreCountUtilizationChartProps {
    datasets?: TypedPerfTableRow[][];
    maxCores: number;
}

function PerfCoreCountUtilizationChart({ datasets = [], maxCores }: PerfCoreCountUtilizationChartProps) {
    const perfReport = useAtomValue(activePerformanceReportAtom);
    const comparisonReportList = useAtomValue(comparisonPerformanceReportListAtom);

    const chartDataDuration = useMemo(
        () =>
            datasets.map((data, dataIndex) => ({
                x: data?.map((_row, index) => index + 1),
                y: data?.map((row) => row.cores),
                type: 'bar',
                hovertemplate: `<b>%{data.name}</b><br />Operation: %{x}<br />Cores: %{y}<extra></extra>`,
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
                y: data?.map((row) => getCoreUtilization(row, maxCores)).filter((value) => value !== -1),
                yaxis: 'y2',
                hovertemplate: `<b>%{data.name}</b><br />Operation: %{x}<br />Utilization: %{y}<extra></extra>`,
                name: getPlotLabel(dataIndex, perfReport?.reportName, comparisonReportList),
                legendgroup: `group${dataIndex}`,
                marker: {
                    color: getSecondaryDataColours(dataIndex),
                },
            })) as Partial<PlotData>[],
        [datasets, perfReport, comparisonReportList, maxCores],
    );

    const maxY2Value = Math.max(...chartDataUtilization.flatMap((data) => (data.y as number[]) ?? []));

    const configuration: PlotConfiguration = {
        margin: {
            l: 100,
            r: 0,
            b: 50,
            t: 0,
        },
        showLegend: true,
        xAxis: {
            title: { text: 'Operation' },
            range: [0, getAxisUpperRange(datasets)],
        },
        yAxis: {
            title: { text: 'Core Count' },
            tickformat: 'd',
            hoverformat: ',.2r',
            range: [0, maxCores],
        },
        yAxis2: {
            title: { text: 'Utilization (%)' },
            tickformat: '.0%',
            hoverformat: '.2%',
            range: [0, maxY2Value],
        },
    };

    return (
        <>
            {maxY2Value > 1 && <PerfMultiDeviceNotice />}
            <PerfChart
                title='Core Count + Utilization'
                chartData={[...chartDataDuration, ...chartDataUtilization]}
                configuration={configuration}
            />
        </>
    );
}

export default PerfCoreCountUtilizationChart;
