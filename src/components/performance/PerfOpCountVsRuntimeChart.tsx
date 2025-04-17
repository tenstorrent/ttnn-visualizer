// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { Marker, PerfTableRow } from '../../definitions/PerfTable';
import PerfChart from './PerfChart';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';

interface PerfOpCountVsRuntimeChartProps {
    selectedOpCodes: Marker[];
    data?: PerfTableRow[];
}

function PerfOpCountVsRuntimeChart({ selectedOpCodes, data = [] }: PerfOpCountVsRuntimeChartProps) {
    const opCodes = useMemo(
        () => [...new Set(data?.filter((row) => row.raw_op_code !== undefined).map((row) => row.raw_op_code))],
        [data],
    );
    const totalRuntime = useMemo(() => data.reduce(getRuntimeLength, 0), [data]);

    const opCountData = useMemo(
        () =>
            opCodes.map(
                (opCode) =>
                    ({
                        x: ['Op Count'],
                        y: [data.filter((row) => row.raw_op_code === opCode).length / data.length],
                        type: 'bar',
                        name: '',
                        hovertemplate: `${opCode}<br />%{y:.1%}`,
                        marker: {
                            color: selectedOpCodes.find((selected) => selected.opCode === opCode)?.colour,
                        },
                    }) as Partial<PlotData>,
            ),
        [data, opCodes, selectedOpCodes],
    );

    const opRuntimeData = useMemo(
        () =>
            opCodes.map(
                (opCode) =>
                    ({
                        x: ['Runtime %'],
                        y: [
                            data.filter((row) => row.raw_op_code === opCode).reduce(getRuntimeLength, 0) / totalRuntime,
                        ],
                        type: 'bar',
                        name: '',
                        hovertemplate: `${opCode}<br />%{y:.1%}`,
                        marker: {
                            color: selectedOpCodes.find((selected) => selected.opCode === opCode)?.colour,
                        },
                    }) as Partial<PlotData>,
            ),
        [data, opCodes, selectedOpCodes, totalRuntime],
    );

    const configuration: PlotConfiguration = {
        margin: {
            l: 0,
            r: 0,
            b: 0,
            t: 0,
        },
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

const getRuntimeLength = (sum: number, row: PerfTableRow) =>
    sum + (row.device_time ? parseInt(row.device_time, 10) : 0);

export default PerfOpCountVsRuntimeChart;
