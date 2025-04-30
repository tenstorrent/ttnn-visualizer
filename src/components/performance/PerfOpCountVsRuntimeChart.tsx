// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { useMemo } from 'react';
import { PlotData } from 'plotly.js';
import { useAtomValue } from 'jotai';
import { Marker, PerfTableRow } from '../../definitions/PerfTable';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';
import PerfChart from './PerfChart';
import { activePerformanceReportAtom, comparisonPerformanceReportAtom } from '../../store/app';
import getPlotLabel from '../../functions/getPlotLabel';

interface PerfOpCountVsRuntimeChartProps {
    selectedOpCodes: Marker[];
    datasets?: PerfTableRow[][];
}

function PerfOpCountVsRuntimeChart({ selectedOpCodes, datasets = [] }: PerfOpCountVsRuntimeChartProps) {
    const perfReport = useAtomValue(activePerformanceReportAtom);
    const comparisonReport = useAtomValue(comparisonPerformanceReportAtom);
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
                            x: [`Op Count ${datasets.length > 1 ? `(${dataIndex + 1})` : ''}`],
                            y: [data.filter((row) => row.raw_op_code === opCode).length / data.length],
                            type: 'bar',
                            name: getPlotLabel(dataIndex, perfReport, comparisonReport),
                            hovertemplate: `${opCode}<br />%{y:.1%}`,
                            marker: {
                                color: selectedOpCodes.find((selected) => selected.opCode === opCode)?.colour,
                            },
                        }) as Partial<PlotData>,
                ),
            ),
        [datasets, opCodes, selectedOpCodes, perfReport, comparisonReport],
    );

    const opRuntimeData = useMemo(
        () =>
            datasets.map((data, dataIndex) =>
                opCodes.map(
                    (opCode) =>
                        ({
                            x: [`Runtime % ${datasets.length > 1 ? `(${dataIndex + 1})` : ''}`],
                            y: [
                                data.filter((row) => row.raw_op_code === opCode).reduce(getRuntimeLength, 0) /
                                    data.reduce(getRuntimeLength, 0),
                            ],
                            type: 'bar',
                            name: getPlotLabel(dataIndex, perfReport, comparisonReport),
                            hovertemplate: `${opCode}<br />%{y:.1%}`,
                            marker: {
                                color: selectedOpCodes.find((selected) => selected.opCode === opCode)?.colour,
                            },
                        }) as Partial<PlotData>,
                ),
            ),
        [datasets, opCodes, selectedOpCodes, perfReport, comparisonReport],
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
