// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Config, Layout, PlotData } from 'plotly.js';
import { Helmet } from 'react-helmet-async';
import { useSetAtom } from 'jotai';
import { useEffect, useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import { useBuffers, useReportMeta } from '../hooks/useAPI';
import { reportMetaAtom } from '../store/app';
import { BufferType } from '../model/BufferType';
import { BufferSummaryConfiguration } from '../definitions/PlotConfigurations';

export default function BufferSummary() {
    const report = useReportMeta();
    const setMeta = useSetAtom(reportMetaAtom);
    const { data: buffersByOperation, isLoading } = useBuffers(BufferType.L1);
    const [augmentedChart, setAugmentedChart] = useState<Partial<PlotData>[]>([]);

    // Needs to be in a useEffect to avoid a bad setState call
    useEffect(() => {
        if (report.status === 'success' && report.data) {
            setMeta(report.data);
        }
    }, [report, setMeta]);

    const isZoomedIn = false;
    const plotZoomRange = [0, 1];
    const memorySize = 2000000;
    const range = isZoomedIn ? plotZoomRange : [0, memorySize];

    const layout: Partial<Layout> = {
        height: BufferSummaryConfiguration.height,
        xaxis: {
            autorange: false,
            title: BufferSummaryConfiguration.title || '',
            range,
            showgrid: true,
            fixedrange: true,
            zeroline: false,
            tickformat: 'd',
            color: 'white',
            gridcolor: '#999',
        },
        yaxis: {
            range: [0, 1],
            fixedrange: true,
            showgrid: false,
            zeroline: false,
            showticklabels: false,
        },
        margin: BufferSummaryConfiguration.margin,
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'white',
        shapes: [
            {
                type: 'rect',
                xref: 'paper',
                yref: 'paper',
                x0: 0,
                y0: 0,
                x1: 1,
                y1: 1,
                line: {
                    color: 'black',
                    width: 0.5,
                },
            },
        ],
        showlegend: false,
        hovermode: 'closest',
        barmode: 'stack',
    };

    const config: Partial<Config> = {
        displayModeBar: false,
        displaylogo: false,
        // staticPlot: onBufferClick === undefined,
    };

    useMemo(() => {
        if (buffersByOperation) {
            setAugmentedChart(
                buffersByOperation.slice(157, 165).map((operation) => ({
                    type: 'bar',
                    x: operation.buffers.map((buffer) => buffer.address + buffer.size),
                    y: [operation.id],
                    orientation: 'h',
                    name: operation.id,
                })),
            );
        }
    }, [buffersByOperation]);

    console.log(augmentedChart);

    return (
        <>
            <Helmet title='Buffer summary' />

            {isLoading ? (
                'Loading...'
            ) : (
                <Plot
                    data={augmentedChart}
                    layout={layout}
                    config={config}
                    // onClick={onBufferClick}
                    // onHover={(data) => setHoveredPoint(data.points[0].x as number)}
                    // onUnhover={() => setHoveredPoint(null)}
                />
                // <ul>
                //     {buffersByOperation?.map((operation) => (
                //         <li>
                //             {operation.id} - {operation.buffers.length}
                //         </li>
                //     ))}
                // </ul>
            )}
        </>
    );
}
