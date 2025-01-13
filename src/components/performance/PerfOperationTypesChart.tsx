// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import Plot from 'react-plotly.js';
import { Layout, PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { RowData } from '../../definitions/PerfTable';
import 'styles/components/PerformanceOperationTypesChart.scss';
import { PerfChartConfig } from '../../definitions/PlotConfigurations';

interface PerfOperationTypesChartProps {
    data?: RowData[];
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

function PerfOperationTypesChart({ data }: PerfOperationTypesChartProps) {
    const operationTypes = data?.reduce(
        (types, operation) => {
            const operationCode = operation['OP CODE'] as string;

            if (types[operationCode] !== undefined && typeof types[operationCode] === 'number') {
                types[operationCode] += 1;
            } else {
                types[operationCode] = 1;
            }

            return types;
        },
        {} as Record<string, number>,
    );

    const chartData = useMemo(
        () =>
            ({
                values: Object.values(operationTypes ?? []),
                labels: Object.keys(operationTypes ?? []),
                type: 'pie',
                textinfo: 'percent',
                hovertemplate: `Type: %{label}<br />Count: %{value}<extra></extra>`,
            }) as Partial<PlotData>,
        [operationTypes],
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
