import Plot from 'react-plotly.js';
import { Config, Layout, PlotData } from 'plotly.js';
import { RowData } from './performance/PerfTable';

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

function PerformanceOperationTypesChart({ data }: PerformanceOperationTypesChartProps) {
    const operationTypes = data
        ?.filter((row) => !isHostOperation(row?.['OP CODE'] as string | undefined))
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

    const chartData = {
        values: Object.values(operationTypes ?? []),
        labels: Object.keys(operationTypes ?? []),
        type: 'pie',
        textinfo: 'percent',
    } as Partial<PlotData>;

    return (
        <>
            <h2>Operation Types Pie Chart</h2>

            <Plot
                data={[chartData]}
                layout={LAYOUT}
                config={CONFIG}
            />
        </>
    );
}

const isHostOperation = (operation?: string) => operation?.includes('(torch)') || operation === '';

export default PerformanceOperationTypesChart;
