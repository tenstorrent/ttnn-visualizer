// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { PlotData } from 'plotly.js';
import { Marker, TypedPerfTableRow } from '../../definitions/PerfTable';
import {
    DurationHistogramBucketSegment,
    EMPTY_SAMPLES_SUMMARY,
    OTHER_OP_CODE_COLOUR,
    OTHER_OP_CODE_LABEL,
    PERF_DURATION_HISTOGRAM_ACTIVE_REPORT_SUBTITLE,
    PERF_DURATION_HISTOGRAM_ARIA_LABEL,
    PERF_DURATION_HISTOGRAM_EMPTY_MESSAGE,
    SAMPLE_OPS_PER_BUCKET,
} from '../../definitions/PerfDurationHistogram';
import { OnOpCodeClick, PERF_CHART_LABELS, PerfChartId } from '../../definitions/PerformanceCharts';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';
import { TEST_IDS } from '../../definitions/TestIds';
import buildDurationHistogram from '../../functions/buildDurationHistogram';
import { getHistogramOpCodeStacks } from '../../functions/getDisplayedHistogramOpCodes';
import { useHandlePerfChartPlotClick } from '../../hooks/useHandlePerfChartPlotClick';
import PerfChart from './PerfChart';
import PerfChartFrame from './PerfChartFrame';
import 'styles/components/PerfDurationHistogram.scss';

/** Plotly hovertemplate indexes: [0]=rawOpCode, [1]=bucketTotal, [2]=sampleOpsSummary */
type DurationHistogramCustomData = [string, number, string];

interface OtherBucketStats {
    count: number;
    sampleOpsSummary: string;
}

interface PerfDurationHistogramProps {
    rows: TypedPerfTableRow[];
    selectedOpCodes: Marker[];
    onOpCodeClick?: OnOpCodeClick;
    /** When true, surface that comparison reports are not plotted here. */
    hasComparisonReports?: boolean;
}

function PerfDurationHistogram({
    rows,
    selectedOpCodes,
    onOpCodeClick,
    hasComparisonReports = false,
}: PerfDurationHistogramProps) {
    const histogramData = useMemo(() => buildDurationHistogram(rows), [rows]);
    const handlePlotClick = useHandlePerfChartPlotClick(onOpCodeClick);

    const bucketLabels = useMemo(
        () => histogramData.buckets.map((bucket) => bucket.bucket.label),
        [histogramData.buckets],
    );

    const colourByOpCode = useMemo(
        () => new Map<string, Marker['colour']>(selectedOpCodes.map((marker) => [marker.opCode, marker.colour])),
        [selectedOpCodes],
    );

    const { displayedOpCodes, rolledUpOpCodes } = useMemo(
        () => getHistogramOpCodeStacks(histogramData),
        [histogramData],
    );

    const segmentMaps = useMemo(
        () =>
            histogramData.buckets.map(
                (bucket) =>
                    new Map<string, DurationHistogramBucketSegment>(
                        bucket.segmentsByOpCode.map((segment) => [segment.rawOpCode, segment]),
                    ),
            ),
        [histogramData.buckets],
    );

    const otherBucketStats = useMemo((): OtherBucketStats[] => {
        if (rolledUpOpCodes.size === 0) {
            return [];
        }

        return segmentMaps.map((segmentMap) => {
            let count = 0;
            const samples: string[] = [];

            rolledUpOpCodes.forEach((opCode) => {
                const segment = segmentMap.get(opCode);
                if (!segment) {
                    return;
                }

                count += segment.count;
                samples.push(...segment.sampleOps);
            });

            return {
                count,
                sampleOpsSummary: samples.slice(0, SAMPLE_OPS_PER_BUCKET).join(', ') || EMPTY_SAMPLES_SUMMARY,
            };
        });
    }, [rolledUpOpCodes, segmentMaps]);

    const chartData = useMemo(() => {
        return displayedOpCodes.map((rawOpCode) => {
            const isOther = rawOpCode === OTHER_OP_CODE_LABEL;

            const customData: DurationHistogramCustomData[] = histogramData.buckets.map((bucket, bucketIndex) => {
                if (isOther) {
                    return [
                        '',
                        bucket.totalCount,
                        otherBucketStats[bucketIndex]?.sampleOpsSummary ?? EMPTY_SAMPLES_SUMMARY,
                    ];
                }

                const segment = segmentMaps[bucketIndex].get(rawOpCode);
                const sampleOpsSummary = (segment?.sampleOps ?? []).join(', ') || EMPTY_SAMPLES_SUMMARY;

                return [rawOpCode, bucket.totalCount, sampleOpsSummary];
            });

            return {
                x: bucketLabels,
                y: histogramData.buckets.map((_, bucketIndex) => {
                    if (isOther) {
                        return otherBucketStats[bucketIndex]?.count ?? 0;
                    }

                    return segmentMaps[bucketIndex].get(rawOpCode)?.count ?? 0;
                }),
                type: 'bar',
                name: rawOpCode,
                customdata: customData as unknown as PlotData['customdata'],
                hovertemplate: '%{x}<br />%{fullData.name}: %{y}<br />Bucket total: %{customdata[1]}<extra></extra>',
                marker: {
                    color: isOther ? OTHER_OP_CODE_COLOUR : colourByOpCode.get(rawOpCode),
                },
            } as Partial<PlotData>;
        });
    }, [bucketLabels, colourByOpCode, displayedOpCodes, histogramData.buckets, otherBucketStats, segmentMaps]);

    const configuration: PlotConfiguration = {
        margin: {
            l: 50,
            r: 0,
            b: 80,
            t: 0,
        },
        barMode: 'stack',
        showLegend: false,
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
    const subtitle = hasComparisonReports ? PERF_DURATION_HISTOGRAM_ACTIVE_REPORT_SUBTITLE : undefined;

    return (
        <div
            className='perf-duration-histogram-chart'
            aria-label={PERF_DURATION_HISTOGRAM_ARIA_LABEL}
            data-testid={TEST_IDS.PERF_DURATION_HISTOGRAM}
        >
            {histogramData.buckets.length === 0 ? (
                <PerfChartFrame
                    id={PerfChartId.OpDurationHistogram}
                    title={title}
                    subtitle={subtitle}
                    isClickable={false}
                >
                    <p className='perf-duration-histogram-empty'>{PERF_DURATION_HISTOGRAM_EMPTY_MESSAGE}</p>
                </PerfChartFrame>
            ) : (
                <div className='perf-duration-histogram'>
                    <PerfChart
                        id={PerfChartId.OpDurationHistogram}
                        title={title}
                        subtitle={subtitle}
                        chartData={chartData}
                        configuration={configuration}
                        onPlotClick={onOpCodeClick ? handlePlotClick : undefined}
                    />
                </div>
            )}
        </div>
    );
}

export default PerfDurationHistogram;
