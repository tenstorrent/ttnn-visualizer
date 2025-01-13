// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { RowData } from '../../definitions/PerfTable';
import getCoreUtilization from '../../functions/getCoreUtilization';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';
import PerfChart from './PerfChart';

interface PerfCoreCountUtilizationChartProps {
    data?: RowData[];
    maxCores: number;
}

function PerfCoreCountUtilizationChart({ data, maxCores }: PerfCoreCountUtilizationChartProps) {
    const chartDataDuration = useMemo(
        () =>
            ({
                x: data?.map((_row, index) => index + 1),
                y: data?.map((row) => row['CORE COUNT']),
                type: 'bar',
                hovertemplate: `Operation: %{x}<br />Core Count: %{y}`,
                name: '',
            }) as Partial<PlotData>,
        [data],
    );

    const chartDataUtilization = useMemo(
        () =>
            ({
                x: data?.map((_row, index) => index + 1),
                y: data?.map((row) => getCoreUtilization(row, maxCores)).filter((value) => value !== -1),
                yaxis: 'y2',
                hovertemplate: `Operation: %{x}<br />Utilization: %{y}`,
                name: '',
            }) as Partial<PlotData>,
        [data, maxCores],
    );

    const configuration: PlotConfiguration = {
        margin: {
            l: 100,
            r: 0,
            b: 50,
            t: 0,
        },
        xAxis: {
            title: { text: 'Operation' },
            range: [0, data?.length ?? 0],
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
            range: [0, 1],
        },
    };

    return (
        <PerfChart
            title='Operation Core Count + Utilization'
            chartData={[chartDataDuration, chartDataUtilization]}
            configuration={configuration}
        />
    );
}

export default PerfCoreCountUtilizationChart;
