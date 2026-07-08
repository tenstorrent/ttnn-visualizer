// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import classNames from 'classnames';
import { Layout, PlotData, PlotMouseEvent } from 'plotly.js';
import { useCallback, useMemo } from 'react';
import Plot from '../../libs/PlotComponent';
import { Marker, TypedPerfTableRow } from '../../definitions/PerfTable';
import { PERF_CHART_LABELS, PERF_CHART_TABLE_FILTER_HINT, PerfChartId } from '../../definitions/PerformanceCharts';
import { PerfChartConfig } from '../../definitions/PlotConfigurations';
import { TEST_IDS } from '../../definitions/TestIds';
import { getRawOpCodeFromPlotClick } from '../../functions/getRawOpCodeFromPlotClick';
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

    const handlePlotClick = useCallback(
        (event: Readonly<PlotMouseEvent>) => {
            if (!onOpCodeClick) {
                return;
            }

            const opCode = getRawOpCodeFromPlotClick(event);
            if (opCode) {
                onOpCodeClick(opCode);
            }
        },
        [onOpCodeClick],
    );

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

            {isClickable ? (
                <p
                    className='perf-chart-hint'
                    data-testid={TEST_IDS.PERF_CHART_TABLE_FILTER_HINT}
                >
                    {PERF_CHART_TABLE_FILTER_HINT}
                </p>
            ) : null}

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
