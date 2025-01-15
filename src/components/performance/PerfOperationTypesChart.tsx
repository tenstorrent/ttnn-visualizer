// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import Plot from 'react-plotly.js';
import { Layout, PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { Marker, RowData } from '../../definitions/PerfTable';
import 'styles/components/PerformanceOperationTypesChart.scss';
import { PerfChartConfig } from '../../definitions/PlotConfigurations';

interface PerfOperationTypesChartProps {
    data: RowData[];
    selectedOpCodes: Marker[];
}

const LAYOUT: Partial<Layout> = {
    autosize: true,
    paper_bgcolor: 'transparent',
    legend: {
        font: {
            color: 'white',
        },
    },
    margin: {
        l: 0,
        r: 0,
        b: 0,
        t: 0,
    },
};

function PerfOperationTypesChart({ data, selectedOpCodes }: PerfOperationTypesChartProps) {
    const opCodes = useMemo(
        () => [...new Set(data?.filter((row) => row['OP CODE'] !== undefined).map((row) => row['OP CODE']))],
        [data],
    );

    const chartData = useMemo(
        () =>
            ({
                values: opCodes.map((opCode) => data.filter((row) => row['OP CODE'] === opCode).length),
                labels: [...opCodes],
                type: 'pie',
                textinfo: 'percent',
                hovertemplate: `Type: %{label}<br />Count: %{value}<extra></extra>`,
                marker: {
                    colors: opCodes.map(
                        (opCode) => selectedOpCodes.find((selected) => selected.opCode === opCode)?.colour,
                    ),
                },
            }) as Partial<PlotData>,
        [data, opCodes, selectedOpCodes],
    );

    return (
        <div className='operation-types-chart'>
            <h2>Operation Types</h2>

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
