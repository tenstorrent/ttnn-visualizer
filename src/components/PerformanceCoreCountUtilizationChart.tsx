import { Config, Layout, PlotData } from 'plotly.js';
import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import 'styles/components/PerformanceScatterChart.scss';
import { RowData } from '../definitions/PerfTable';
import { DeviceArchitecture } from '../model/APIData';
import getCoreUtilization from '../functions/getCoreUtilization';
import getCoreCount from '../functions/getCoreCount';

interface PerformanceCoreCountlUtilizationChartProps {
    data?: RowData[];
    architecture: DeviceArchitecture;
}

const GRID_COLOUR = '#575757';
const LINE_COLOUR = '#575757';
const LEGEND_COLOUR = '#FFF';

const DESIRED_OP_CODES = ['matmul', 'conv'];

const CONFIG: Partial<Config> = {
    displayModeBar: false,
    displaylogo: false,
    responsive: true,
};

function PerformanceCoreCountUtilizationChart({ data, architecture }: PerformanceCoreCountlUtilizationChartProps) {
    const filteredOps = useMemo(
        () => data?.filter((row) => isDesiredOperation(row?.['OP CODE'] as string | undefined)) ?? [],
        [data],
    );

    const chartDataDuration = useMemo(
        () =>
            ({
                x: filteredOps?.map((_row, index) => index + 1),
                y: filteredOps?.map((row) => row['CORE COUNT']),
                type: 'bar',
                hovertemplate: `Operation: %{x}<br />Core Count: %{y}`,
                name: '',
            }) as Partial<PlotData>,
        [filteredOps],
    );

    const chartDataUtilization = useMemo(
        () =>
            ({
                x: filteredOps?.map((_row, index) => index + 1),
                y: filteredOps?.map((row) => getCoreUtilization(row, architecture)).filter((value) => value !== -1),
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
            color: LEGEND_COLOUR,
            title: {
                text: 'Operation',
                font: {
                    color: LEGEND_COLOUR,
                },
            },
            range: [0, filteredOps.length],
            fixedrange: true,
            zeroline: false,
        },
        yaxis: {
            gridcolor: GRID_COLOUR,
            linecolor: LINE_COLOUR,
            color: LEGEND_COLOUR,
            title: {
                text: 'Core Count',
                font: {
                    color: LEGEND_COLOUR,
                },
                standoff: 20,
            },
            tickformat: 'd',
            hoverformat: ',.2r',
            range: [0, getCoreCount(architecture)],
            automargin: true,
            fixedrange: true,
            zeroline: false,
        },
        yaxis2: {
            gridcolor: GRID_COLOUR,
            linecolor: LINE_COLOUR,
            color: LEGEND_COLOUR,
            title: {
                text: 'Utilization (%)',
                font: {
                    color: LEGEND_COLOUR,
                },
                standoff: 20,
            },
            tickformat: '.0%',
            hoverformat: '.2%',
            overlaying: 'y',
            side: 'right',
            range: [0, 1],
            automargin: true,
            fixedrange: true,
            zeroline: false,
        },
    };

    return (
        <div className='scatter-chart'>
            <h3>Operation Core Count + Utilization (MatMul)</h3>

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

export default PerformanceCoreCountUtilizationChart;
