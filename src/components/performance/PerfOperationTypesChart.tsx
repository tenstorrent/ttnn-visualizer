// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import classNames from 'classnames';
import { Layout, PlotData } from 'plotly.js';
import { useMemo } from 'react';
import Plot from '../../libs/PlotComponent';
import { Marker, TypedPerfTableRow } from '../../definitions/PerfTable';
import { PERF_CHART_LABELS, PerfChartId } from '../../definitions/PerformanceCharts';
import { PerfChartConfig } from '../../definitions/PlotConfigurations';
import { useHandlePerfChartPlotClick } from '../../hooks/useHandlePerfChartPlotClick';
import PerfChartFilterHint from './PerfChartFilterHint';
import 'styles/components/PerformanceOperationTypesChart.scss';

interface PerfOperationTypesChartProps {
    reportTitle: string;
    opCodes: Marker[];
    data?: TypedPerfTableRow[];
    className?: string;
    id?: string;
    onOpCodeClick?: (opCode: string) => void;
}

const LAYOUT: Partial<Layout> = {
    autosize: true,
    paper_bgcolor: 'transparent',
    margin: {
        l: 50,
        r: 50,
        b: 50,
        t: 50,
    },
    showlegend: false,
};

function PerfOperationTypesChart({
    reportTitle,
    data = [],
    opCodes,
    className = '',
    id,
    onOpCodeClick,
}: PerfOperationTypesChartProps) {
    const filteredOpCodes = useMemo(
        () => [...new Set(data?.filter((row) => row.raw_op_code !== undefined).map((row) => row.raw_op_code))],
        [data],
    );
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

    const isClickable = onOpCodeClick != null;

    return (
        <div
            id={id}
            className={classNames('operation-types-chart', className, {
                'perf-chart-clickable': isClickable,
            })}
        >
            <h3>{PERF_CHART_LABELS[PerfChartId.OperationTypes]}</h3>
            <p>{reportTitle}</p>

            <PerfChartFilterHint isVisible={isClickable} />

            <Plot
                className='chart'
                data={[chartData]}
                layout={LAYOUT}
                config={PerfChartConfig}
                onClick={isClickable ? handlePlotClick : undefined}
                useResizeHandler
            />
        </div>
    );
}

export default PerfOperationTypesChart;
