// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { PerfTableRow } from '../../definitions/PerfTable';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';
import PerfChart from './PerfChart';
import { activePerformanceReportAtom, comparisonPerformanceReportAtom } from '../../store/app';
import getPlotLabel from '../../functions/getPlotLabel';
import { getAxisUpperRange } from '../../functions/perfFunctions';
import { getPrimaryDataColours, getSecondaryDataColours } from '../../definitions/PerformancePlotColours';

interface PerfDeviceTimeChartProps {
    datasets?: PerfTableRow[][];
}

function PerfDeviceTimeChart({ datasets = [] }: PerfDeviceTimeChartProps) {
    const perfReport = useAtomValue(activePerformanceReportAtom);
    const comparisonReport = useAtomValue(comparisonPerformanceReportAtom);

    const deviceTimes = useMemo(
        () =>
            datasets.map((data, dataIndex) => ({
                x: data?.map((_row, index) => index + 1),
                y: data?.map((row) => parseFloat(row.device_time) * 1000), // Convert microseconds to nanoseconds
                type: 'bar',
                hovertemplate: `<b>%{data.name}</b><br />Operation: %{x}<br />Device time: %{y} ns<extra></extra>`,
                name: getPlotLabel(dataIndex, perfReport, comparisonReport),
                legendgroup: `group${dataIndex}`,
                marker: {
                    color: getPrimaryDataColours(dataIndex),
                },
            })) as Partial<PlotData>[],
        [datasets, perfReport, comparisonReport],
    );

    const idealTimes = useMemo(
        () =>
            datasets.map((data, dataIndex) => ({
                x: data?.map((_row, index) => index + 1),
                y: data?.map((row) => row.pm_ideal_ns),
                hovertemplate: `<b>%{data.name}</b><br />Operation: %{x}<br />Ideal time: %{y} ns<extra></extra>`,
                name: getPlotLabel(dataIndex, perfReport, comparisonReport),
                legendgroup: `group${dataIndex}`,
                marker: {
                    color: getSecondaryDataColours(dataIndex),
                },
            })) as Partial<PlotData>[],
        [datasets, perfReport, comparisonReport],
    );

    const maxDeviceTime = Math.max(
        ...datasets.flatMap((data) => data.map((row) => parseFloat(row.device_time) * 1000)),
    ); // Convert microseconds to nanoseconds
    const maxIdealTime = Math.max(...datasets.flatMap((data) => data.map((row) => parseFloat(row.pm_ideal_ns))));

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
            title: { text: 'Time (ns)' },
            tickformat: 'd',
            hoverformat: ',.2r',
            range: [0, Math.max(maxDeviceTime, maxIdealTime)],
        },
    };

    return (
        <PerfChart
            title='Device Time + Ideal Time'
            chartData={[...deviceTimes, ...idealTimes]}
            configuration={configuration}
        />
    );
}

export default PerfDeviceTimeChart;
