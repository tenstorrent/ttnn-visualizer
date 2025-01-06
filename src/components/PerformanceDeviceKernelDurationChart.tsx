import { Config, Layout, PlotData } from 'plotly.js';
import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import 'styles/components/PerformanceScatterChart.scss';
import { RowData } from '../definitions/PerfTable';

interface PerformanceDeviceKernelDurationChartProps {
    data?: RowData[];
}

const GRID_COLOUR = '#575757';
const LEGEND_COLOUR = '#FFF';

const LAYOUT: Partial<Layout> = {
    autosize: true,
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    margin: {
        l: 50,
        r: 0,
        b: 50,
        t: 0,
    },
    xaxis: {
        gridcolor: GRID_COLOUR,
        linecolor: GRID_COLOUR,
        title: {
            text: 'Operation',
            font: {
                color: LEGEND_COLOUR,
            },
        },
        color: LEGEND_COLOUR,
        zerolinecolor: 'transparent',
    },
    yaxis: {
        gridcolor: GRID_COLOUR,
        linecolor: GRID_COLOUR,
        title: {
            text: 'Device Kernel Duration (ns)',
            font: {
                color: LEGEND_COLOUR,
            },
            standoff: 20,
        },
        tickformat: 'd',
        hoverformat: ',.2r',
        color: LEGEND_COLOUR,
        automargin: true,
    },
};

const CONFIG: Partial<Config> = {
    displayModeBar: false,
    displaylogo: false,
    responsive: true,
};

function PerformanceDeviceKernelDurationChart({ data }: PerformanceDeviceKernelDurationChartProps) {
    const filteredOps = data?.filter((row) => row?.['DEVICE KERNEL DURATION [ns]']);

    const chartData = useMemo(
        () =>
            ({
                x: filteredOps?.map((_row, index) => index + 1),
                y: filteredOps?.map((row) => row['DEVICE KERNEL DURATION [ns]']),
                type: 'scatter',
                mode: 'lines',
                name: '',
                hovertemplate: `Operation: %{x}<br />Device Kernel Duration: %{y} ns`,
            }) as Partial<PlotData>,
        [filteredOps],
    );

    return (
        <div className='scatter-chart'>
            <h3>Device Kernel Duration</h3>

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

export default PerformanceDeviceKernelDurationChart;
