// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import Plot from 'react-plotly.js';
import { Config, Layout, PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { RowData } from '../definitions/PerfTable';
import 'styles/components/PerformanceOperationTypesChart.scss';

interface PerformanceOperationTypesChartProps {
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

const CONFIG: Partial<Config> = {
    displayModeBar: false,
    displaylogo: false,
    responsive: true,
};

const HOST_OP_MARKER = '(torch)';

const OP_TYPES = {
    MatMul: 'MatMul',
    Conv: 'Conv',
    InterleavedToSharded: 'I2S',
    MaxPool: 'MaxPool',
    Move: 'Move',
    Reduce: 'Reduce',
    Reshard: 'Reshard',
    'Tile/Untile': 'Tile/Untile',
    Binary: 'Binary',
    Halo: 'Halo',
};

function PerformanceOperationTypesChart({ data }: PerformanceOperationTypesChartProps) {
    const operationTypes = data
        ?.filter((row) => isDesiredOperationType(row?.['OP CODE']))
        .reduce(
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
            }) as Partial<PlotData>,
        [operationTypes],
    );

    return (
        <div className='operation-types-chart'>
            <h2>Operation Types Pie Chart</h2>

            <Plot
                className='chart'
                data={[chartData]}
                layout={LAYOUT}
                config={CONFIG}
                useResizeHandler
            />
        </div>
    );
}

const isDesiredOperationType = (operation?: string): boolean =>
    !operation?.includes(HOST_OP_MARKER) &&
    Object.keys(OP_TYPES).some((type) => operation?.toLowerCase().includes(type?.toLowerCase() ?? '')) &&
    operation !== '';

export default PerformanceOperationTypesChart;
