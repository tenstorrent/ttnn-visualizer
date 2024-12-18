import { Config, Layout, PlotData } from 'plotly.js';
import { useMemo, useState } from 'react';
import { Select } from '@blueprintjs/select';
import { Button, MenuItem } from '@blueprintjs/core';
import Plot from 'react-plotly.js';
import isValidNumber from '../functions/isValidNumber';
import 'styles/components/PerformanceScatterChart.scss';
import { RowData } from '../definitions/PerfTable';

interface PerformanceOperationKernelUtilizationChartProps {
    data?: RowData[];
}

const GRID_COLOUR = 'transparent';
const LINE_COLOUR = '#575757';
const LEGEND_COLOUR = '#FFF';

const DESIRED_OP_CODES = ['matmul', 'conv'];

const LAYOUT: Partial<Layout> = {
    autosize: true,
    dragmode: false,
    height: 450,
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
        tickformat: '.0%',
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

enum DeviceConfiguration {
    Grayskull = 'Grayskull',
    Wormhole = 'Wormhole',
}

const CORE_COUNT = {
    [DeviceConfiguration.Grayskull]: 108,
    [DeviceConfiguration.Wormhole]: 64,
};

function PerformanceOperationKernelUtilizationChart({ data }: PerformanceOperationKernelUtilizationChartProps) {
    const [deviceConfiguration, setDeviceConfiguration] = useState(DeviceConfiguration.Wormhole);

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
                y: filteredOps?.map((row) => getUtilization(row, deviceConfiguration)).filter((value) => value !== -1),
                yaxis: 'y2',
                hovertemplate: `Duration: %{x} ns<br />Utilization: %{y}`,
                name: '',
            }) as Partial<PlotData>,
        [filteredOps, deviceConfiguration],
    );

    return (
        <div className='scatter-chart'>
            <h3>Operation Device Kernel Duration + Utilization (MatMul)</h3>

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

            <Plot
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

export default PerformanceOperationKernelUtilizationChart;
