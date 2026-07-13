// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { PlotData } from 'plotly.js';
import { Marker, TypedPerfTableRow } from '../../definitions/PerfTable';
import { MAX_LEGEND_OP_CODES } from '../../definitions/PerfDurationHistogram';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';
import { TEST_IDS } from '../../definitions/TestIds';
import buildDurationHistogram from '../../functions/buildDurationHistogram';
import PerfChart from './PerfChart';
import 'styles/components/PerfDurationHistogram.scss';

interface DurationHistogramPointMeta {
    totalCount: number;
    sampleOps: string[];
}

interface PerfDurationHistogramProps {
    id: string;
    title: string;
    rows: TypedPerfTableRow[];
    opCodeOptions: Marker[];
}

function PerfDurationHistogram({ id, title, rows, opCodeOptions }: PerfDurationHistogramProps) {
    const histogramData = useMemo(() => buildDurationHistogram(rows), [rows]);

    const bucketLabels = useMemo(
        () => histogramData.buckets.map((bucket) => bucket.bucket.label),
        [histogramData.buckets],
    );

    const colourByOpCode = useMemo(
        () => new Map(opCodeOptions.map((marker) => [marker.opCode, marker.colour])),
        [opCodeOptions],
    );

    const opCodesInHistogram = useMemo(() => {
        const opCodes = new Set<string>();
        histogramData.buckets.forEach((bucket) => {
            bucket.segmentsByOpCode.forEach((segment) => opCodes.add(segment.rawOpCode));
        });

        return [...opCodes];
    }, [histogramData.buckets]);

    const chartData = useMemo(() => {
        return opCodesInHistogram.map((rawOpCode) => {
            const customData: DurationHistogramPointMeta[] = histogramData.buckets.map((bucket) => {
                const segment = bucket.segmentsByOpCode.find((entry) => entry.rawOpCode === rawOpCode);

                return {
                    totalCount: bucket.totalCount,
                    sampleOps: segment?.sampleOps ?? [],
                };
            });

            return {
                x: bucketLabels,
                y: histogramData.buckets.map((bucket) => {
                    const segment = bucket.segmentsByOpCode.find((entry) => entry.rawOpCode === rawOpCode);
                    return segment?.count ?? 0;
                }),
                type: 'bar',
                name: rawOpCode,
                customdata: customData as unknown as PlotData['customdata'],
                hovertemplate:
                    '%{x}<br />%{fullData.name}: %{y}<br />Bucket total: %{customdata.totalCount}<extra></extra>',
                marker: {
                    color: colourByOpCode.get(rawOpCode),
                },
            } as Partial<PlotData>;
        });
    }, [bucketLabels, colourByOpCode, histogramData.buckets, opCodesInHistogram]);

    const configuration: PlotConfiguration = {
        margin: {
            l: 50,
            r: 0,
            b: 80,
            t: 0,
        },
        barMode: 'stack',
        showLegend: opCodesInHistogram.length <= MAX_LEGEND_OP_CODES,
        xAxis: {
            title: {
                text: 'Device time',
            },
        },
        yAxis: {
            title: {
                text: 'Op count',
            },
        },
    };

    if (histogramData.buckets.length === 0) {
        return <p className='perf-duration-histogram-empty'>No device ops available for duration histogram.</p>;
    }

    return (
        <div
            className='perf-duration-histogram'
            data-testid={TEST_IDS.PERF_DURATION_HISTOGRAM}
        >
            <PerfChart
                id={id}
                title={title}
                chartData={chartData}
                configuration={configuration}
            />
        </div>
    );
}

export default PerfDurationHistogram;
