// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { PerfTableRow } from '../../definitions/PerfTable';
import PerfChart from './PerfChart';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';

interface PerfDeviceKernelRuntimeChartProps {
    maxCores: number;
    data?: PerfTableRow[];
}

function PerfDeviceKernelRuntimeChart({ maxCores, data = [] }: PerfDeviceKernelRuntimeChartProps) {
    const chartDataCoreCount = useMemo(
        () =>
            ({
                x: data?.map((_row, index) => index + 1),
                y: data?.map((row) => row.cores),
                type: 'bar',
                hovertemplate: `Operation: %{x}<br />Cores: %{y}`,
                name: '',
            }) as Partial<PlotData>,
        [data],
    );

    const chartDataDuration = useMemo(
        () =>
            ({
                x: data?.map((_row, index) => index + 1),
                y: data?.map((row) => row.device_time),
                yaxis: 'y2',
                hovertemplate: `Operation: %{x}<br />Device Kernel Duration: %{y} ns`,
                name: '',
            }) as Partial<PlotData>,
        [data],
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
            title: { text: 'Device Kernel Duration (ns)' },
            tickformat: 'd',
            hoverformat: ',.2r',
        },
    };

    return (
        <PerfChart
            title='Core Count + Device Kernel Runtime'
            chartData={[chartDataCoreCount, chartDataDuration]}
            configuration={configuration}
        />
    );
}

export default PerfDeviceKernelRuntimeChart;
