// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import classNames from 'classnames';
import { Layout, PlotData } from 'plotly.js';
import { useMemo } from 'react';
import Plot from '../../libs/PlotComponent';
import { Marker, TypedPerfTableRow } from '../../definitions/PerfTable';
import { PERF_CHART_LABELS, PerfChartId } from '../../definitions/PerformanceCharts';
import 'styles/components/PerformanceOperationTypesChart.scss';
import { PerfChartConfig } from '../../definitions/PlotConfigurations';

interface PerfOperationTypesChartProps {
    reportTitle: string;
    opCodes: Marker[];
    data?: TypedPerfTableRow[];
    className?: string;
    id?: string;
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
}: PerfOperationTypesChartProps) {
    const filteredOpCodes = useMemo(
        () => [...new Set(data?.filter((row) => row.raw_op_code !== undefined).map((row) => row.raw_op_code))],
        [data],
    );

    const chartData = useMemo(
        () =>
            ({
                values: filteredOpCodes.map((opCode) => data.filter((row) => row.raw_op_code === opCode).length),
                labels: [...filteredOpCodes],
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
        <div
            id={id}
            className={classNames('operation-types-chart', className)}
        >
            <h3>{PERF_CHART_LABELS[PerfChartId.OperationTypes]}</h3>
            <p>{reportTitle}</p>

            <Plot
                className='chart'
                data={[chartData]}
                layout={LAYOUT}
                config={PerfChartConfig}
                useResizeHandler
            />
        </div>
    );
}

export default PerfOperationTypesChart;
