import { Config, Layout, PlotData } from 'plotly.js';
import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import isValidNumber from '../functions/isValidNumber';
import 'styles/components/PerformanceScatterChart.scss';
import { RowData } from '../definitions/PerfTable';
import { DeviceArchitecture } from '../model/APIData';

interface PerformanceOperationKernelUtilizationChartProps {
    data?: RowData[];
    architecture: DeviceArchitecture;
}

const GRID_COLOUR = 'transparent';
const LINE_COLOUR = '#575757';
const LEGEND_COLOUR = '#FFF';

const DESIRED_OP_CODES = ['matmul', 'conv'];

const LAYOUT: Partial<Layout> = {
    autosize: true,
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    showlegend: false,
    margin: {
        l: 70,
        r: 70,
        b: 50,
        t: 0,
    },
    xaxis: {
        gridcolor: GRID_COLOUR,
        linecolor: LINE_COLOUR,
        title: {
            text: 'Operation Number',
            font: {
                color: LEGEND_COLOUR,
            },
        },
        color: LEGEND_COLOUR,
        zerolinecolor: 'transparent',
    },
    yaxis: {
        gridcolor: GRID_COLOUR,
        linecolor: LINE_COLOUR,
        title: {
            text: 'Device Kernel Duration (ns)',
            font: {
                color: LEGEND_COLOUR,
            },
            standoff: 40,
        },
        tickformat: 'd',
        hoverformat: ',.2r',
        color: LEGEND_COLOUR,
        zerolinecolor: 'transparent',
    },
    yaxis2: {
        gridcolor: GRID_COLOUR,
        linecolor: LINE_COLOUR,
        title: {
            text: 'Utilization (%)',
            font: {
                color: LEGEND_COLOUR,
            },
        },
        tickformat: '.2%',
        hoverformat: '.2%',
        color: LEGEND_COLOUR,
        overlaying: 'y',
        side: 'right',
    },
};

const CONFIG: Partial<Config> = {
    displayModeBar: false,
    displaylogo: false,
    responsive: true,
};

function PerformanceOperationKernelUtilizationChart({
    data,
    architecture,
}: PerformanceOperationKernelUtilizationChartProps) {
    const filteredOps = data?.filter((row) => isDesiredOperation(row?.['OP CODE'] as string | undefined));

    const chartDataDuration = useMemo(
        () =>
            ({
                x: filteredOps?.map((_row, index) => index + 1),
                y: filteredOps?.map((row) => row['DEVICE KERNEL DURATION [ns]']),
                type: 'bar',
                hovertemplate: `Operation number: %{x}<br />Device Kernel Duration: %{y} ns`,
                name: '',
            }) as Partial<PlotData>,
        [filteredOps],
    );

    const chartDataUtilization = useMemo(
        () =>
            ({
                x: filteredOps?.map((_row, index) => index + 1),
                y: filteredOps?.map((row) => getUtilization(row, architecture)).filter((value) => value !== -1),
                yaxis: 'y2',
                hovertemplate: `Duration: %{x} ns<br />Utilization: %{y}`,
                name: '',
            }) as Partial<PlotData>,
        [filteredOps, architecture],
    );

    return (
        <div className='scatter-chart'>
            <h3>Operation Device Kernel Duration + Utilization (MatMul)</h3>

            <Plot
                className='chart'
                data={[chartDataDuration, chartDataUtilization]}
                layout={LAYOUT}
                config={CONFIG}
                useResizeHandler
            />
        </div>
    );
}

const isDesiredOperation = (operation?: string): boolean => {
    const opCode = operation?.toLowerCase();

    return DESIRED_OP_CODES.some((code) => opCode?.includes(code));
};

const getUtilization = (row: RowData, architecture: DeviceArchitecture): number => {
    const CORE_COUNT = {
        grayskull: 108,
        wormhole_b0: 64,
    };

    const ideal = typeof row['PM IDEAL [ns]'] === 'string' ? parseInt(row['PM IDEAL [ns]'], 10) : NaN;
    const kernelDuration =
        typeof row['DEVICE KERNEL DURATION [ns]'] === 'string' ? parseInt(row['DEVICE KERNEL DURATION [ns]'], 10) : NaN;
    const coreCount = typeof row['CORE COUNT'] === 'string' ? parseInt(row['CORE COUNT'], 10) : NaN;

    if (!isValidNumber(ideal) || !isValidNumber(kernelDuration) || !isValidNumber(coreCount)) {
        return -1;
    }

    return (ideal / kernelDuration) * (CORE_COUNT[architecture] / coreCount);
};

export default PerformanceOperationKernelUtilizationChart;
