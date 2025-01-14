// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { RowData } from '../../definitions/PerfTable';
import PerfChart from './PerfChart';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';

interface PerfOpCountVsRuntimeChartProps {
    data: RowData[];
}
const MARKER_COLOURS = [
    'rgb(31, 119, 180)',
    'rgb(255, 127, 14)',
    'rgb(44, 160, 44)',
    'rgb(214, 39, 40)',
    'rgb(148, 103, 189)',
    'rgb(140, 86, 75)',
    'rgb(227, 119, 194)',
    'rgb(188, 189, 34)',
    'rgb(23, 190, 207)',
    'rgb(255, 187, 120)',
    'rgb(40, 108, 26)',
    'rgb(255, 152, 150)',
    'rgb(197, 176, 213)',
    'rgb(196, 156, 148)',
    'rgb(247, 182, 210)',
    'rgb(199, 199, 199)',
    'rgb(219, 219, 141)',
    'rgb(158, 218, 229)',
    'rgb(57, 59, 121)',
    'rgb(82, 84, 163)',
    'rgb(107, 110, 207)',
    'rgb(156, 158, 222)',
    'rgb(255, 127, 14)',
];

function PerfOpCountVsRuntimeChart({ data }: PerfOpCountVsRuntimeChartProps) {
    const opCodes = useMemo(
        () => [...new Set(data?.filter((row) => row['OP CODE'] !== undefined).map((row) => row['OP CODE']))],
        [data],
    );
    const totalRuntime = useMemo(() => data.reduce(getRuntimeLength, 0), [data]);

    const opCountData = useMemo(
        () =>
            opCodes.map(
                (opCode, index) =>
                    ({
                        x: ['Op Count'],
                        y: [data.filter((row) => row['OP CODE'] === opCode).length / data.length],
                        type: 'bar',
                        name: '',
                        hovertemplate: `${opCode}<br />%{y:.0%}`,
                        marker: {
                            color: MARKER_COLOURS[index],
                        },
                        colorscale: 'Greens',
                    }) as Partial<PlotData>,
            ),
        [data, opCodes],
    );

    const opRuntimeData = useMemo(
        () =>
            opCodes.map(
                (opCode, index) =>
                    ({
                        x: ['Runtime %'],
                        y: [data.filter((row) => row['OP CODE'] === opCode).reduce(getRuntimeLength, 0) / totalRuntime],
                        type: 'bar',
                        name: '',
                        hovertemplate: `${opCode}<br />%{y:.0%}`,
                        marker: {
                            color: MARKER_COLOURS[index],
                        },
                        colorscale: 'Greens',
                    }) as Partial<PlotData>,
            ),
        [data, opCodes, totalRuntime],
    );

    const configuration: PlotConfiguration = {
        barMode: 'stack',
        yAxis: {
            tickformat: '.0%',
            range: [0, 1],
        },
    };

    return (
        <PerfChart
            title='Operation Count vs Runtime Contribution'
            chartData={[...opCountData, ...opRuntimeData]}
            configuration={configuration}
        />
    );
}

const getRuntimeLength = (sum: number, row: RowData) =>
    sum + (row['DEVICE KERNEL DURATION [ns]'] ? parseInt(row['DEVICE KERNEL DURATION [ns]'], 10) : 0);

export default PerfOpCountVsRuntimeChart;
