import { Config, Layout, PlotData } from 'plotly.js';
import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import 'styles/components/PerformanceScatterChart.scss';
import { RowData } from '../definitions/PerfTable';

interface PerformanceDeviceRuntimeChartProps {
    data?: RowData[];
}

const GRID_COLOUR = '#575757';
const LEGEND_COLOUR = '#FFF';

const LAYOUT: Partial<Layout> = {
    autosize: true,
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    margin: {
        l: 80,
        r: 0,
        b: 50,
        t: 0,
    },
    xaxis: {
        gridcolor: GRID_COLOUR,
        linecolor: GRID_COLOUR,
        title: {
            text: 'Core Count',
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
            standoff: 40,
        },
        tickformat: 'd',
        hoverformat: ',.2r',
        color: LEGEND_COLOUR,
    },
};

const CONFIG: Partial<Config> = {
    displayModeBar: false,
    displaylogo: false,
    responsive: true,
};

function PerformanceDeviceRuntimeChart({ data }: PerformanceDeviceRuntimeChartProps) {
    const filteredOps = data?.filter((row) => row?.['CORE COUNT'] && row?.['DEVICE KERNEL DURATION [ns]']);
    // const filteredOps = data;

    const chartData = useMemo(
        () =>
            ({
                x: filteredOps?.map((row) => row['CORE COUNT']),
                y: filteredOps?.map((row) => row['DEVICE KERNEL DURATION [ns]']),
                mode: 'markers',
                type: 'scatter',
                name: '',
                marker: {
                    size: 10,
                },
                hovertemplate: `Duration: %{y} ns<br />Cores: %{x}`,
            }) as Partial<PlotData>,
        [filteredOps],
    );

    // console.log(chartData);

    return (
        <div className='scatter-chart'>
            <h3>Device Kernel Runtime vs Core Count</h3>

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

export default PerformanceDeviceRuntimeChart;
