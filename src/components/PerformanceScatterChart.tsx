import { Config, Layout, PlotData } from 'plotly.js';
import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import isValidNumber from '../functions/isValidNumber';
import 'styles/components/PerformanceScatterChart.scss';
import { RowData } from '../definitions/PerfTable';
import { DeviceArchitecture } from '../model/APIData';

interface PerformanceScatterChartProps {
    data?: RowData[];
    architecture: DeviceArchitecture;
}

const GRID_COLOUR = '#575757';
const LEGEND_COLOUR = '#FFF';

const LAYOUT: Partial<Layout> = {
    autosize: true,
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    margin: {
        l: 60,
        r: 0,
        b: 50,
        t: 0,
    },
    xaxis: {
        gridcolor: GRID_COLOUR,
        linecolor: GRID_COLOUR,
        title: {
            text: 'Device Kernel Duration (ns)',
            font: {
                color: LEGEND_COLOUR,
            },
        },
        tickformat: 'd',
        hoverformat: ',.2r',
        color: LEGEND_COLOUR,
        zerolinecolor: 'transparent',
    },
    yaxis: {
        gridcolor: GRID_COLOUR,
        linecolor: GRID_COLOUR,
        title: {
            text: 'Utilization (%)',
            font: {
                color: LEGEND_COLOUR,
            },
        },
        tickformat: '.0%',
        hoverformat: '.2%',
        color: LEGEND_COLOUR,
    },
};

const CONFIG: Partial<Config> = {
    displayModeBar: false,
    displaylogo: false,
    responsive: true,
};

function PerformanceScatterChart({ data, architecture }: PerformanceScatterChartProps) {
    const filteredOps = data?.filter((row) => isMatMulConv(row?.['OP CODE'] as string | undefined));

    const chartData = useMemo(
        () =>
            ({
                x: filteredOps?.map((row) => row['DEVICE KERNEL DURATION [ns]']),
                y: filteredOps?.map((row) => getUtilization(row, architecture)).filter((value) => value !== -1),
                mode: 'markers',
                type: 'scatter',
                name: '',
                marker: {
                    size: 10,
                },
                hovertemplate: `Duration: %{x} ns<br />Utilization: %{y}`,
            }) as Partial<PlotData>,
        [filteredOps, architecture],
    );

    return (
        <div className='scatter-chart'>
            <h3>Device Kernel Duration vs Utilization (Matmul)</h3>

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

const isMatMulConv = (operation?: string): boolean => {
    const opCode = operation?.toLowerCase();
    const keywords = ['matmul', 'conv'];

    return keywords.some((keyword) => opCode?.includes(keyword));
};

const getUtilization = (row: RowData, architecture: DeviceArchitecture): number => {
    const CORE_COUNT = {
        [DeviceArchitecture.Grayskull]: 108,
        [DeviceArchitecture.Wormhole]: 64,
    };

    const ideal = row['PM IDEAL [ns]'] ? parseInt(row['PM IDEAL [ns]'], 10) : null;
    const kernelDuration = row['DEVICE KERNEL DURATION [ns]'] ? parseInt(row['DEVICE KERNEL DURATION [ns]'], 10) : null;
    const coreCount = row['CORE COUNT'] ? parseInt(row['CORE COUNT'], 10) : null;

    if (!isValidNumber(ideal) || !isValidNumber(kernelDuration) || !isValidNumber(coreCount)) {
        return -1;
    }

    return (ideal / kernelDuration) * (CORE_COUNT[architecture] / coreCount);
};

export default PerformanceScatterChart;
