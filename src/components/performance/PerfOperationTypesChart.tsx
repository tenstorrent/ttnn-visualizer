// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import Plot from 'react-plotly.js';
import { Layout, PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { Marker, PerfTableRow } from '../../definitions/PerfTable';
import 'styles/components/PerformanceOperationTypesChart.scss';
import { PerfChartConfig } from '../../definitions/PlotConfigurations';

interface PerfOperationTypesChartProps {
    opCodes: Marker[];
    data?: PerfTableRow[];
}

const LAYOUT: Partial<Layout> = {
    autosize: true,
    paper_bgcolor: 'transparent',
    margin: {
        l: 0,
        r: 0,
        b: 0,
        t: 0,
    },
    showlegend: false,
};

function PerfOperationTypesChart({ data = [], opCodes }: PerfOperationTypesChartProps) {
    const filteredOpCodes = useMemo(
        () => [...new Set(data?.filter((row) => row.raw_op_code !== undefined).map((row) => row.raw_op_code))],
        [data],
    );

    const chartData = useMemo(
        () =>
            ({
                values: filteredOpCodes.map((opCode) => data.filter((row) => row.raw_op_code === opCode).length),
                labels: [...filteredOpCodes],
                type: 'pie',
                textinfo: 'percent',
                hovertemplate: `%{label}<br />Count: %{value}<extra></extra>`,
                marker: {
                    colors: filteredOpCodes.map(
                        (opCode) => opCodes.find((selected) => selected.opCode === opCode)?.colour,
                    ),
                },
            }) as Partial<PlotData>,
        [data, opCodes, filteredOpCodes],
    );

    return (
        <div className='operation-types-chart'>
            <h3>Operation Types</h3>

            <Plot
                className='chart'
                data={[chartData]}
                layout={LAYOUT}
                config={PerfChartConfig}
                useResizeHandler
            />
        </div>
    );
}

export default PerfOperationTypesChart;
