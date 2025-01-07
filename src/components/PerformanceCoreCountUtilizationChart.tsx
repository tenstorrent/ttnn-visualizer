// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Layout, PlotData } from 'plotly.js';
import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import 'styles/components/PerformanceScatterChart.scss';
import { RowData } from '../definitions/PerfTable';
import { DeviceArchitecture } from '../model/APIData';
import getCoreUtilization from '../functions/getCoreUtilization';
import getCoreCount from '../functions/getCoreCount';
import { PerfChartConfig, PerfChartLayout } from '../definitions/PlotConfigurations';

interface PerformanceCoreCountlUtilizationChartProps {
    data?: RowData[];
    architecture: DeviceArchitecture;
}

const DESIRED_OP_CODES = ['matmul', 'conv'];

function PerformanceCoreCountUtilizationChart({ data, architecture }: PerformanceCoreCountlUtilizationChartProps) {
    const filteredOps = useMemo(
        () => data?.filter((row) => isDesiredOperation(row?.['OP CODE'] as string | undefined)) ?? [],
        [data],
    );

    const chartDataDuration = useMemo(
        () =>
            ({
                x: filteredOps?.map((_row, index) => index + 1),
                y: filteredOps?.map((row) => row['CORE COUNT']),
                type: 'bar',
                hovertemplate: `Operation: %{x}<br />Core Count: %{y}`,
                name: '',
            }) as Partial<PlotData>,
        [filteredOps],
    );

    const chartDataUtilization = useMemo(
        () =>
            ({
                x: filteredOps?.map((_row, index) => index + 1),
                y: filteredOps?.map((row) => getCoreUtilization(row, architecture)).filter((value) => value !== -1),
                yaxis: 'y2',
                hovertemplate: `Operation: %{x}<br />Utilization: %{y}`,
                name: '',
            }) as Partial<PlotData>,
        [filteredOps, architecture],
    );

    const layout: Partial<Layout> = {
        ...PerfChartLayout,
        xaxis: {
            ...PerfChartLayout.xaxis,
            range: [0, filteredOps.length],
        },
        yaxis: {
            ...PerfChartLayout.yaxis,
            tickformat: 'd',
            hoverformat: ',.2r',
            range: [0, getCoreCount(architecture)],
        },
        yaxis2: {
            ...PerfChartLayout.yaxis2,
            tickformat: '.0%',
            hoverformat: '.2%',
            range: [0, 1],
        },
    };

    if (layout?.xaxis?.title && typeof layout.xaxis.title !== 'string') {
        layout.xaxis.title.text = 'Operation';
    }
    if (layout?.yaxis?.title && typeof layout.yaxis.title !== 'string') {
        layout.yaxis.title.text = 'Core Count';
    }
    if (layout?.yaxis2?.title && typeof layout.yaxis2.title !== 'string') {
        layout.yaxis2.title.text = 'Utilization (%)';
    }
    layout.margin = {
        l: 100,
        r: 0,
        b: 50,
        t: 0,
    };

    return (
        <div className='scatter-chart'>
            <h3>Operation Core Count + Utilization (MatMul)</h3>

            <Plot
                className='chart'
                data={[chartDataDuration, chartDataUtilization]}
                layout={layout}
                config={PerfChartConfig}
                useResizeHandler
            />
        </div>
    );
}

const isDesiredOperation = (operation?: string): boolean => {
    const opCode = operation?.toLowerCase();

    return DESIRED_OP_CODES.some((code) => opCode?.includes(code));
};

export default PerformanceCoreCountUtilizationChart;
