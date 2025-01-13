// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { RowData } from '../../definitions/PerfTable';
import getCoreUtilization from '../../functions/getCoreUtilization';
import PerfChart from './PerfChart';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';

interface PerfOperationKernelUtilizationChartProps {
    data?: RowData[];
    maxCores: number;
}

const DESIRED_OP_CODES = ['matmul', 'conv'];

function PerfOperationKernelUtilizationChart({ data, maxCores }: PerfOperationKernelUtilizationChartProps) {
    const filteredOps = useMemo(
        () => data?.filter((row) => isDesiredOperation(row?.['OP CODE'] as string | undefined)) ?? [],
        [data],
    );

    const chartDataDuration = useMemo(
        () =>
            ({
                x: filteredOps?.map((_row, index) => index + 1),
                y: filteredOps?.map((row) => row['DEVICE KERNEL DURATION [ns]']),
                type: 'bar',
                hovertemplate: `Operation: %{x}<br />Duration: %{y} ns`,
                name: '',
            }) as Partial<PlotData>,
        [filteredOps],
    );

    const chartDataUtilization = useMemo(
        () =>
            ({
                x: filteredOps?.map((_row, index) => index + 1),
                y: filteredOps?.map((row) => getCoreUtilization(row, maxCores)).filter((value) => value !== -1) ?? [],
                yaxis: 'y2',
                hovertemplate: `Operation: %{x}<br />Utilization: %{y}`,
                name: '',
            }) as Partial<PlotData>,
        [filteredOps, maxCores],
    );

    const configuration: PlotConfiguration = {
        margin: {
            l: 100,
            r: 0,
            b: 50,
            t: 0,
        },
        xAxis: {
            range: [0, filteredOps.length],
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
            range: [0, Math.max(...(chartDataDuration.y as number[]))],
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
            title='Operation Device Kernel Duration + Utilization (MatMul)'
            chartData={[chartDataDuration, chartDataUtilization]}
            configuration={configuration}
        />
    );
}

const isDesiredOperation = (operation?: string): boolean => {
    const opCode = operation?.toLowerCase();

    return DESIRED_OP_CODES.some((code) => opCode?.includes(code));
};

export default PerfOperationKernelUtilizationChart;
