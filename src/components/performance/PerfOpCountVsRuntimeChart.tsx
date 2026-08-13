// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useMemo } from 'react';
import { PlotData } from 'plotly.js';
import { useAtomValue } from 'jotai';
import { Marker, TypedPerfTableRow } from '../../definitions/PerfTable';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';
import { OnOpCodeClick, PERF_CHART_LABELS, PerfChartId } from '../../definitions/PerformanceCharts';
import { useHandlePerfChartPlotClick } from '../../hooks/useHandlePerfChartPlotClick';
import getPlotLabel from '../../functions/getPlotLabel';
import { getUniqueChartRawOpCodes } from '../../functions/getUniqueChartRawOpCodes';
import PerfChart from './PerfChart';
import { activePerformanceReportAtom, comparisonPerformanceReportListAtom } from '../../store/app';

interface PerfOpCountVsRuntimeChartProps {
    selectedOpCodes: Marker[];
    datasets?: TypedPerfTableRow[][];
    onOpCodeClick?: OnOpCodeClick;
}

function PerfOpCountVsRuntimeChart({ selectedOpCodes, datasets = [], onOpCodeClick }: PerfOpCountVsRuntimeChartProps) {
    const perfReport = useAtomValue(activePerformanceReportAtom);
    const comparisonReportList = useAtomValue(comparisonPerformanceReportListAtom);
    const opCodes = useMemo(() => getUniqueChartRawOpCodes(datasets.flat()), [datasets]);

    const selectedOpCodeSet = useMemo(
        () => new Set(selectedOpCodes.map((selected) => selected.opCode)),
        [selectedOpCodes],
    );

    const filteredOpCodes = useMemo(
        () => opCodes.filter((opCode) => selectedOpCodeSet.has(opCode)),
        [opCodes, selectedOpCodeSet],
    );

    const handlePlotClick = useHandlePerfChartPlotClick(onOpCodeClick);

    const opCountData = useMemo(
        () =>
            datasets.map((data, dataIndex) =>
                filteredOpCodes.map(
                    (opCode) =>
                        ({
                            x: [`Op Count % ${datasets.length > 1 ? `(${dataIndex + 1})` : ''}`],
                            y: [data.filter((row) => row.raw_op_code === opCode).length / data.length],
                            type: 'bar',
                            name: getPlotLabel(dataIndex, perfReport?.reportName, comparisonReportList),
                            hovertemplate: `${opCode}<br />%{y:.1%}`,
                            customdata: [opCode],
                            marker: {
                                color: selectedOpCodes.find((selected) => selected.opCode === opCode)?.colour,
                            },
                        }) as Partial<PlotData>,
                ),
            ),
        [datasets, filteredOpCodes, selectedOpCodes, perfReport, comparisonReportList],
    );

    const opDeviceTimeData = useMemo(
        () =>
            datasets.map((data, dataIndex) =>
                filteredOpCodes.map(
                    (opCode) =>
                        ({
                            x: [`Device Time % ${datasets.length > 1 ? `(${dataIndex + 1})` : ''}`],
                            y: [
                                data.filter((row) => row.raw_op_code === opCode).reduce(getDeviceTimePercentage, 0) /
                                    data.reduce(getDeviceTimePercentage, 0),
                            ],
                            type: 'bar',
                            name: getPlotLabel(dataIndex, perfReport?.reportName, comparisonReportList),
                            hovertemplate: `${opCode}<br />%{y:.1%}`,
                            customdata: [opCode],
                            marker: {
                                color: selectedOpCodes.find((selected) => selected.opCode === opCode)?.colour,
                            },
                        }) as Partial<PlotData>,
                ),
            ),
        [datasets, filteredOpCodes, selectedOpCodes, perfReport, comparisonReportList],
    );

    const chartData = useMemo(
        () => [...opCountData.flat(), ...opDeviceTimeData.flat()],
        [opCountData, opDeviceTimeData],
    );

    // Memoized because PerfChart derives the Plotly layout from it, and a fresh object redraws
    // the chart — and re-reads the chart chrome from the stylesheet — on every render.
    const configuration = useMemo<PlotConfiguration>(
        () => ({
            // No margin override: all-zero was previously ignored by PerfChart and would now
            // clip category labels (xaxis has no automargin).
            barMode: 'stack',
            yAxis: {
                tickformat: '.0%',
                range: [0, 1],
            },
        }),
        [],
    );

    return (
        <PerfChart
            id={PerfChartId.OpCountVsRuntime}
            title={PERF_CHART_LABELS[PerfChartId.OpCountVsRuntime]}
            chartData={chartData}
            configuration={configuration}
            onPlotClick={onOpCodeClick ? handlePlotClick : undefined}
        />
    );
}

const getDeviceTimePercentage = (sum: number, row: TypedPerfTableRow) => sum + (row.device_time ?? 0);

export default PerfOpCountVsRuntimeChart;
