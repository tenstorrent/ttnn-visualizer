// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { RowData } from '../../definitions/PerfTable';
import { DeviceArchitecture } from '../../model/APIData';
import getCoreUtilization from '../../functions/getCoreUtilization';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';
import PerfChart from './PerfChart';

interface PerfKernelDurationUtilizationChartProps {
    data?: RowData[];
    architecture: DeviceArchitecture;
}

function PerfKernelDurationUtilizationChart({ data, architecture }: PerfKernelDurationUtilizationChartProps) {
    const filteredOps = data?.filter((row) => isMatMulConv(row?.['OP CODE'] as string | undefined));

    const chartData = useMemo(
        () =>
            ({
                x: filteredOps?.map((row) => row['DEVICE KERNEL DURATION [ns]']),
                y: filteredOps?.map((row) => getCoreUtilization(row, architecture)).filter((value) => value !== -1),
                mode: 'markers',
                type: 'scatter',
                name: '',
                marker: {
                    size: 10,
                },
                hovertemplate: `Duration: %{x} ns<br />Utilization: %{y}`,
            }) as Partial<PlotData>,
        [filteredOps, architecture],
    );

    const configuration: Partial<PlotConfiguration> = {
        xAxis: {
            title: {
                text: 'Device Kernel Duration (ns)',
            },
            tickformat: 'd',
            hoverformat: ',.2r',
        },
        yAxis: {
            title: {
                text: 'Utilization (%)',
            },
            tickformat: '.0%',
            hoverformat: '.2%',
        },
    };

    return (
        <PerfChart
            title='Device Kernel Duration vs Utilization (Matmul)'
            chartData={[chartData]}
            configuration={configuration}
        />
    );
}

const isMatMulConv = (operation?: string): boolean => {
    const opCode = operation?.toLowerCase();
    const keywords = ['matmul', 'conv'];

    return keywords.some((keyword) => opCode?.includes(keyword));
};

export default PerfKernelDurationUtilizationChart;
