// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import type { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import { Marker } from '../../definitions/PerfTable';
import { TypedPerfTableRow } from '../../model/PerfTable';
import { OnOpCodeClick, PERF_CHART_LABELS, PerfChartId } from '../../definitions/PerformanceCharts';
import { PerfPieChartLayout } from '../../definitions/PlotConfigurations';
import { useHandlePerfChartPlotClick } from '../../hooks/useHandlePerfChartPlotClick';
import { getUniqueChartRawOpCodes } from '../../functions/getUniqueChartRawOpCodes';
import PerfChart from './PerfChart';

interface PerfOperationTypesChartProps {
    reportTitle: string;
    opCodes: Marker[];
    data?: TypedPerfTableRow[];
    className?: string;
    id?: string;
    onOpCodeClick?: OnOpCodeClick;
}

function PerfOperationTypesChart({
    reportTitle,
    data = [],
    opCodes,
    className = '',
    id,
    onOpCodeClick,
}: PerfOperationTypesChartProps) {
    const filteredOpCodes = useMemo(() => getUniqueChartRawOpCodes(data), [data]);
    const handlePlotClick = useHandlePerfChartPlotClick(onOpCodeClick);

    const chartData = useMemo(
        () =>
            ({
                values: filteredOpCodes.map((opCode) => data.filter((row) => row.raw_op_code === opCode).length),
                labels: [...filteredOpCodes],
                customdata: [...filteredOpCodes],
                type: 'pie',
                textinfo: 'percent',
                hovertemplate: `%{label}<br />Count: %{value}<extra></extra>`,
                marker: {
                    colors: filteredOpCodes.map(
                        (opCode) => opCodes.find((selected) => selected.opCode === opCode)?.colour,
                    ),
                },
                outsidetextfont: {
                    color: 'white',
                },
            }) as Partial<PlotData>,
        [data, opCodes, filteredOpCodes],
    );

    return (
        <PerfChart
            id={id}
            title={PERF_CHART_LABELS[PerfChartId.OperationTypes]}
            subtitle={<p>{reportTitle}</p>}
            className={className}
            chartData={[chartData]}
            layout={PerfPieChartLayout}
            onPlotClick={onOpCodeClick ? handlePlotClick : undefined}
        />
    );
}

export default PerfOperationTypesChart;
