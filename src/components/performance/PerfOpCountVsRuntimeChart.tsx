// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { MARKER_COLOURS, Marker, RowData } from '../../definitions/PerfTable';
import PerfChart from './PerfChart';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';

interface PerfOpCountVsRuntimeChartProps {
    data: RowData[];
    selectedOpCodes: Marker[];
}

function PerfOpCountVsRuntimeChart({ data, selectedOpCodes }: PerfOpCountVsRuntimeChartProps) {
    const opCodes = useMemo(
        () => [...new Set(data?.filter((row) => row['OP CODE'] !== undefined).map((row) => row['OP CODE']))],
        [data],
    );
    const totalRuntime = useMemo(() => data.reduce(getRuntimeLength, 0), [data]);

    const opCountData = useMemo(
        () =>
            opCodes.map(
                (opCode) =>
                    ({
                        x: ['Op Count'],
                        y: [data.filter((row) => row['OP CODE'] === opCode).length / data.length],
                        type: 'bar',
                        name: opCode,
                        hovertemplate: `%{y:.1%}`,
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
                (opCode, index) =>
                    ({
                        x: ['Runtime %'],
                        y: [data.filter((row) => row['OP CODE'] === opCode).reduce(getRuntimeLength, 0) / totalRuntime],
                        type: 'bar',
                        name: opCode,
                        hovertemplate: `%{y:.1%}`,
                        marker: {
                            color: MARKER_COLOURS[index],
                        },
                    }) as Partial<PlotData>,
            ),
        [data, opCodes, totalRuntime],
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

const getRuntimeLength = (sum: number, row: RowData) =>
    sum + (row['DEVICE KERNEL DURATION [ns]'] ? parseInt(row['DEVICE KERNEL DURATION [ns]'], 10) : 0);

export default PerfOpCountVsRuntimeChart;
