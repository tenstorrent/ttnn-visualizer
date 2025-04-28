// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { useMemo } from 'react';
import { PlotData } from 'plotly.js';
import { Marker, PerfTableRow } from '../../definitions/PerfTable';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';
import PerfChart from './PerfChart';

interface PerfOpCountVsRuntimeChartProps {
    selectedOpCodes: Marker[];
    datasets?: PerfTableRow[][];
}

function PerfOpCountVsRuntimeChart({ selectedOpCodes, datasets = [] }: PerfOpCountVsRuntimeChartProps) {
    const flattenedData = datasets.flat();
    const opCodes = useMemo(
        () => [...new Set(flattenedData?.filter((row) => row.raw_op_code !== undefined).map((row) => row.raw_op_code))],
        [flattenedData],
    );

    const opCountData = useMemo(
        () =>
            datasets.map((data, dataIndex) =>
                opCodes.map(
                    (opCode) =>
                        ({
                            x: [`Op Count - ${dataIndex + 1}`],
                            y: [data.filter((row) => row.raw_op_code === opCode).length / data.length],
                            type: 'bar',
                            name: '',
                            hovertemplate: `${opCode}<br />%{y:.1%}`,
                            marker: {
                                color: selectedOpCodes.find((selected) => selected.opCode === opCode)?.colour,
                            },
                        }) as Partial<PlotData>,
                ),
            ),
        [datasets, opCodes, selectedOpCodes],
    );

    const opRuntimeData = useMemo(
        () =>
            datasets.map((data, dataIndex) =>
                opCodes.map(
                    (opCode) =>
                        ({
                            x: [`Runtime % - ${dataIndex + 1}`],
                            y: [
                                data.filter((row) => row.raw_op_code === opCode).reduce(getRuntimeLength, 0) /
                                    data.reduce(getRuntimeLength, 0),
                            ],
                            type: 'bar',
                            name: '',
                            hovertemplate: `${opCode}<br />%{y:.1%}`,
                            marker: {
                                color: selectedOpCodes.find((selected) => selected.opCode === opCode)?.colour,
                            },
                        }) as Partial<PlotData>,
                ),
            ),
        [datasets, opCodes, selectedOpCodes],
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
            chartData={[...opCountData.flat(), ...opRuntimeData.flat()]}
            configuration={configuration}
        />
    );
}

const getRuntimeLength = (sum: number, row: PerfTableRow) =>
    sum + (row.device_time ? parseInt(row.device_time, 10) : 0);

export default PerfOpCountVsRuntimeChart;
