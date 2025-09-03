// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { PerfTableRow } from '../../definitions/PerfTable';
import PerfChart from './PerfChart';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';
import getPlotLabel from '../../functions/getPlotLabel';
import { activePerformanceReportAtom, comparisonPerformanceReportListAtom } from '../../store/app';
import { getPrimaryDataColours, getSecondaryDataColours } from '../../definitions/PerformancePlotColours';
import { useDeviceLog } from '../../hooks/useAPI';
import { DeviceArchitecture } from '../../definitions/DeviceArchitecture';
import getCoreCount from '../../functions/getCoreCount';

interface PerfDeviceKernelRuntimeChartProps {
    datasets?: PerfTableRow[][];
}

function PerfDeviceKernelRuntimeChart({ datasets = [] }: PerfDeviceKernelRuntimeChartProps) {
    const { data: deviceLog } = useDeviceLog();
    const perfReport = useAtomValue(activePerformanceReportAtom);
    const comparisonReportList = useAtomValue(comparisonPerformanceReportListAtom);
    const maxDataSize = datasets.reduce((max, data) => Math.max(max, data?.length || 0), 0);
    const architecture = (deviceLog?.deviceMeta?.architecture ?? DeviceArchitecture.WORMHOLE) as DeviceArchitecture;
    const maxCores = getCoreCount(architecture, datasets[0] ?? []);

    const chartDataCoreCount = useMemo(
        () =>
            datasets.map((data, dataIndex) => ({
                x: data?.map((_row, index) => index + 1),
                y: data?.map((row) => row.cores),
                type: 'bar',
                hovertemplate: `Operation: %{x}<br />Cores: %{y}`,
                name: getPlotLabel(dataIndex, perfReport, comparisonReportList),
                showlegend: true,
                legendgroup: `group${dataIndex}`,
                marker: {
                    color: getPrimaryDataColours(dataIndex),
                },
            })) as Partial<PlotData>[],
        [datasets, perfReport, comparisonReportList],
    );

    const chartDataDuration = useMemo(
        () =>
            datasets.map((data, dataIndex) => ({
                x: data?.map((_row, index) => index + 1),
                y: data?.map((row) => row.device_time),
                yaxis: 'y2',
                hovertemplate: `Operation: %{x}<br />Device Kernel Duration: %{y} ns`,
                name: getPlotLabel(dataIndex, perfReport, comparisonReportList),
                showlegend: true,
                legendgroup: `group${dataIndex}`,
                marker: {
                    color: getSecondaryDataColours(dataIndex),
                },
            })) as Partial<PlotData>[],
        [datasets, perfReport, comparisonReportList],
    );

    const configuration: PlotConfiguration = {
        margin: {
            l: 100,
            r: 0,
            b: 50,
            t: 0,
        },
        showLegend: true,
        xAxis: {
            title: { text: 'Operation' },
            range: [0, maxDataSize],
        },
        yAxis: {
            title: { text: 'Core Count' },
            tickformat: 'd',
            hoverformat: ',.2r',
            range: [0, maxCores],
        },
        yAxis2: {
            title: { text: 'Device Kernel Duration (ns)' },
            tickformat: 'd',
            hoverformat: ',.2r',
        },
    };

    return (
        <PerfChart
            title='Core Count + Device Kernel Runtime'
            chartData={[...chartDataCoreCount, ...chartDataDuration]}
            configuration={configuration}
        />
    );
}

export default PerfDeviceKernelRuntimeChart;
