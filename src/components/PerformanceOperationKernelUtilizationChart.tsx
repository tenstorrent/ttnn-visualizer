import { Config, Layout, PlotData } from 'plotly.js';
import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import { RowData } from '../definitions/PerfTable';
import { DeviceArchitecture } from '../model/APIData';
import getCoreUtilization from '../functions/getCoreUtilization';
import 'styles/components/PerformanceScatterChart.scss';

interface PerformanceOperationKernelUtilizationChartProps {
    data?: RowData[];
    architecture: DeviceArchitecture;
}

const GRID_COLOUR = 'transparent';
const LINE_COLOUR = '#575757';
const LEGEND_COLOUR = '#FFF';

const DESIRED_OP_CODES = ['matmul', 'conv'];

const CONFIG: Partial<Config> = {
    displayModeBar: false,
    displaylogo: false,
    responsive: true,
};

function PerformanceOperationKernelUtilizationChart({
    data,
    architecture,
}: PerformanceOperationKernelUtilizationChartProps) {
    const filteredOps = useMemo(
        () => data?.filter((row) => isDesiredOperation(row?.['OP CODE'] as string | undefined)) ?? [],
        [data],
    );

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
                y:
                    filteredOps?.map((row) => getCoreUtilization(row, architecture)).filter((value) => value !== -1) ??
                    [],
                yaxis: 'y2',
                hovertemplate: `Operation: %{x}<br />Utilization: %{y}`,
                name: '',
            }) as Partial<PlotData>,
        [filteredOps, architecture],
    );

    const layout: Partial<Layout> = {
        autosize: true,
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        showlegend: false,
        margin: {
            l: 60,
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
            range: [0, filteredOps.length],
            color: LEGEND_COLOUR,
            fixedrange: true,
            zeroline: false,
        },
        yaxis: {
            gridcolor: GRID_COLOUR,
            linecolor: LINE_COLOUR,
            title: {
                text: 'Device Kernel Duration (ns)',
                font: {
                    color: LEGEND_COLOUR,
                },
                standoff: 20,
            },
            range: [0, Math.max(...(chartDataDuration.y as number[]))],
            automargin: true,
            tickformat: 'd',
            hoverformat: ',.2r',
            color: LEGEND_COLOUR,
            fixedrange: true,
            zeroline: false,
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
            range: [0, 1],
            automargin: true,
            tickformat: '.0%',
            hoverformat: '.2%',
            color: LEGEND_COLOUR,
            overlaying: 'y',
            side: 'right',
            fixedrange: true,
            zeroline: false,
        },
    };

    return (
        <div className='scatter-chart'>
            <h3>Operation Device Kernel Duration + Utilization (MatMul)</h3>

            <Plot
                className='chart'
                data={[chartDataDuration, chartDataUtilization]}
                layout={layout}
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

export default PerformanceOperationKernelUtilizationChart;
