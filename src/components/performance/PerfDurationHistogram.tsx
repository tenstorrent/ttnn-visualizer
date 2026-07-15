// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { PlotData } from 'plotly.js';
import { Marker, TypedPerfTableRow } from '../../definitions/PerfTable';
import { MAX_LEGEND_OP_CODES } from '../../definitions/PerfDurationHistogram';
import { OnOpCodeClick, PERF_CHART_LABELS, PerfChartId } from '../../definitions/PerformanceCharts';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';
import { TEST_IDS } from '../../definitions/TestIds';
import buildDurationHistogram from '../../functions/buildDurationHistogram';
import { useHandlePerfChartPlotClick } from '../../hooks/useHandlePerfChartPlotClick';
import PerfChart from './PerfChart';
import PerfChartFrame from './PerfChartFrame';
import 'styles/components/PerfDurationHistogram.scss';

/** Plotly hovertemplate indexes: [0]=rawOpCode, [1]=bucketTotal, [2]=sampleOpsSummary */
type DurationHistogramCustomData = [string, number, string];

interface PerfDurationHistogramProps {
    rows: TypedPerfTableRow[];
    selectedOpCodes: Marker[];
    onOpCodeClick?: OnOpCodeClick;
}

function PerfDurationHistogram({ rows, selectedOpCodes, onOpCodeClick }: PerfDurationHistogramProps) {
    const histogramData = useMemo(() => buildDurationHistogram(rows), [rows]);
    const handlePlotClick = useHandlePerfChartPlotClick(onOpCodeClick);

    const bucketLabels = useMemo(
        () => histogramData.buckets.map((bucket) => bucket.bucket.label),
        [histogramData.buckets],
    );

    const colourByOpCode = useMemo(
        () => new Map(selectedOpCodes.map((marker) => [marker.opCode, marker.colour])),
        [selectedOpCodes],
    );

    const opCodesInHistogram = useMemo(() => {
        const opCodes = new Set<string>();
        histogramData.buckets.forEach((bucket) => {
            bucket.segmentsByOpCode.forEach((segment) => opCodes.add(segment.rawOpCode));
        });

        return [...opCodes];
    }, [histogramData.buckets]);

    const chartData = useMemo(() => {
        const segmentMaps = histogramData.buckets.map(
            (bucket) => new Map(bucket.segmentsByOpCode.map((segment) => [segment.rawOpCode, segment])),
        );

        return opCodesInHistogram.map((rawOpCode) => {
            const customData: DurationHistogramCustomData[] = histogramData.buckets.map((bucket, bucketIndex) => {
                const segment = segmentMaps[bucketIndex].get(rawOpCode);
                const sampleOpsSummary = (segment?.sampleOps ?? []).join(', ') || '—';

                return [rawOpCode, bucket.totalCount, sampleOpsSummary];
            });

            return {
                x: bucketLabels,
                y: histogramData.buckets.map((_, bucketIndex) => {
                    return segmentMaps[bucketIndex].get(rawOpCode)?.count ?? 0;
                }),
                type: 'bar',
                name: rawOpCode,
                customdata: customData as unknown as PlotData['customdata'],
                hovertemplate:
                    '%{x}<br />%{fullData.name}: %{y}<br />Bucket total: %{customdata[1]}<br />Samples: %{customdata[2]}<extra></extra>',
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

    const title = PERF_CHART_LABELS[PerfChartId.OpDurationHistogram];

    if (histogramData.buckets.length === 0) {
        return (
            <div
                className='perf-duration-histogram-chart'
                aria-label='Op duration distribution'
            >
                <PerfChartFrame
                    id={PerfChartId.OpDurationHistogram}
                    title={title}
                    isClickable={false}
                >
                    <p className='perf-duration-histogram-empty'>No device ops available for duration histogram.</p>
                </PerfChartFrame>
            </div>
        );
    }

    return (
        <div
            className='perf-duration-histogram-chart'
            aria-label='Op duration distribution'
            data-testid={TEST_IDS.PERF_DURATION_HISTOGRAM}
        >
            <div className='perf-duration-histogram'>
                <PerfChart
                    id={PerfChartId.OpDurationHistogram}
                    title={title}
                    chartData={chartData}
                    configuration={configuration}
                    onPlotClick={onOpCodeClick ? handlePlotClick : undefined}
                />
            </div>
        </div>
    );
}

export default PerfDurationHistogram;
