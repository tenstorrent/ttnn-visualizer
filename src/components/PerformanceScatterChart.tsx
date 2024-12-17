import { Config, Layout, PlotData } from 'plotly.js';
import { useMemo, useState } from 'react';
import { Select } from '@blueprintjs/select';
import { Button, MenuItem } from '@blueprintjs/core';
import Plot from 'react-plotly.js';
import { RowData } from './performance/PerfTable';
import isValidNumber from '../functions/isValidNumber';
import 'styles/components/PerformanceScatterChart.scss';

interface PerformanceScatterChartProps {
    data?: RowData[];
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

enum DeviceConfiguration {
    Grayskull = 'Grayskull',
    Wormhole = 'Wormhole',
}

const CORE_COUNT = {
    [DeviceConfiguration.Grayskull]: 108,
    [DeviceConfiguration.Wormhole]: 64,
};

function PerformanceScatterChart({ data }: PerformanceScatterChartProps) {
    const [deviceConfiguration, setDeviceConfiguration] = useState(DeviceConfiguration.Wormhole);

    const filteredOps = data?.filter((row) => isMatMulConv(row?.['OP CODE'] as string | undefined));

    const chartData = useMemo(
        () =>
            ({
                x: filteredOps?.map((row) => row['DEVICE KERNEL DURATION [ns]']),
                y: filteredOps?.map((row) => getUtilization(row, deviceConfiguration)).filter((value) => value !== -1),
                mode: 'markers',
                type: 'scatter',
                name: '',
                marker: {
                    size: 10,
                },
                hovertemplate: `Duration: %{x}ns<br />Utilization: %{y}`,
            }) as Partial<PlotData>,
        [filteredOps, deviceConfiguration],
    );

    return (
        <div className='scatter-chart'>
            <h3>Device Kernel Duration vs Utilization (MatMul)</h3>

            <div className='chart-controls'>
                <span>Select Configuration:</span>

                <Select
                    items={[DeviceConfiguration.Wormhole, DeviceConfiguration.Grayskull]}
                    // eslint-disable-next-line react/no-unstable-nested-components
                    itemRenderer={(value) => (
                        <MenuItem
                            key={value}
                            text={value}
                            label={value}
                            onClick={() => setDeviceConfiguration(value)}
                        />
                    )}
                    filterable={false}
                    onItemSelect={setDeviceConfiguration}
                >
                    <Button
                        text={deviceConfiguration}
                        outlined
                    />
                </Select>
            </div>

            <div>
                <Plot
                    data={[chartData]}
                    layout={LAYOUT}
                    config={CONFIG}
                />
            </div>
        </div>
    );
}

const isMatMulConv = (operation?: string): boolean => {
    const opCode = operation?.toLowerCase();
    const keywords = ['matmul', 'conv'];

    return keywords.some((keyword) => opCode?.includes(keyword));
};

const getUtilization = (row: RowData, deviceConfiguration: DeviceConfiguration): number => {
    const ideal = typeof row['PM IDEAL [ns]'] === 'string' ? parseInt(row['PM IDEAL [ns]'], 10) : NaN;
    const kernelDuration =
        typeof row['DEVICE KERNEL DURATION [ns]'] === 'string' ? parseInt(row['DEVICE KERNEL DURATION [ns]'], 10) : NaN;
    const coreCount = typeof row['CORE COUNT'] === 'string' ? parseInt(row['CORE COUNT'], 10) : NaN;

    if (!isValidNumber(ideal) || !isValidNumber(kernelDuration) || !isValidNumber(coreCount)) {
        return -1;
    }

    return (ideal / kernelDuration) * (CORE_COUNT[deviceConfiguration] / coreCount);
};

export default PerformanceScatterChart;
