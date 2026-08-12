// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { Annotations, ClickAnnotationEvent, PlotData } from 'plotly.js';
import { Marker, TypedPerfTableRow } from '../../definitions/PerfTable';
import {
    DurationHistogramBucketSegment,
    EMPTY_SAMPLES_SUMMARY,
    OTHER_OP_CODE_COLOUR,
    OTHER_OP_CODE_LABEL,
    PERF_DURATION_BUCKET_ANNOTATION_FONT_SIZE,
    PERF_DURATION_BUCKET_ANNOTATION_Y_SHIFT,
    PERF_DURATION_BUCKET_AXIS_TITLE_STANDOFF,
    PERF_DURATION_BUCKET_FILTER_HINT,
    PERF_DURATION_HISTOGRAM_ACTIVE_REPORT_SUBTITLE,
    PERF_DURATION_HISTOGRAM_ARIA_LABEL,
    PERF_DURATION_HISTOGRAM_EMPTY_MESSAGE,
    SAMPLE_OPS_PER_BUCKET,
} from '../../definitions/PerfDurationHistogram';
import { OnOpCodeClick, PERF_CHART_LABELS, PerfChartId } from '../../definitions/PerformanceCharts';
import {
    PERF_CHART_TRANSPARENT,
    PerfChartChrome,
    PlotConfiguration,
    getPerfChartChrome,
} from '../../definitions/PlotConfigurations';
import { TEST_IDS } from '../../definitions/TestIds';
import buildDurationHistogram from '../../functions/buildDurationHistogram';
import { getHistogramOpCodeStacks } from '../../functions/getDisplayedHistogramOpCodes';
import { useHandlePerfChartPlotClick } from '../../hooks/useHandlePerfChartPlotClick';
import { usePrefilterPerfTableByDurationBucket } from '../../hooks/usePrefilterPerfTableByDurationBucket';
import { durationBucketFilterListAtom } from '../../store/app';
import PerfChart from './PerfChart';
import PerfChartFrame from './PerfChartFrame';
import 'styles/components/PerfDurationHistogram.scss';

const CHART_HINTS = [PERF_DURATION_BUCKET_FILTER_HINT];

/** Plotly hovertemplate indexes: [0]=rawOpCode, [1]=bucketTotal, [2]=sampleOpsSummary */
type DurationHistogramCustomData = [string, number, string];

interface OtherBucketStats {
    count: number;
    sampleOpsSummary: string;
}

/** The axis line colour doubles as the muted tone, matching how Blueprint dims a disabled control. */
const getBucketLabelColour = (chrome: PerfChartChrome, isSelected: boolean, isEmpty: boolean): string => {
    if (isSelected) {
        return chrome.surface;
    }

    return isEmpty ? chrome.line : chrome.text;
};

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
    const selectedBucketMinUsList = useAtomValue(durationBucketFilterListAtom);
    const prefilterPerfTableByDurationBucket = usePrefilterPerfTableByDurationBucket();

    const bucketList = useMemo(() => histogramData.buckets.map((entry) => entry.bucket), [histogramData.buckets]);

    const bucketLabels = useMemo(() => bucketList.map((bucket) => bucket.label), [bucketList]);

    // One control per column, standing in for the x tick labels. Selection inverts the control:
    // the text colour becomes the fill and the label flips to the page surface to stay legible,
    // so returning from the table shows which column the filter came from. Decades run contiguously
    // between the extremes, so an empty column can sit between populated ones; its control is muted
    // and stops capturing clicks because filtering by it would empty the table.
    const bucketAnnotations = useMemo<Partial<Annotations>[]>(() => {
        const chrome = getPerfChartChrome();

        return histogramData.buckets.map(({ bucket, totalCount }) => {
            const isEmpty = totalCount === 0;
            const isSelected = selectedBucketMinUsList.includes(bucket.minUs);

            return {
                x: bucket.label,
                xref: 'x',
                y: 0,
                yref: 'paper',
                yanchor: 'top',
                yshift: PERF_DURATION_BUCKET_ANNOTATION_Y_SHIFT,
                text: bucket.label,
                showarrow: false,
                captureevents: !isEmpty,
                borderwidth: 1,
                borderpad: 4,
                bgcolor: isSelected ? chrome.text : PERF_CHART_TRANSPARENT,
                bordercolor: isSelected ? chrome.text : chrome.line,
                font: {
                    size: PERF_DURATION_BUCKET_ANNOTATION_FONT_SIZE,
                    color: getBucketLabelColour(chrome, isSelected, isEmpty),
                },
            };
        });
    }, [histogramData.buckets, selectedBucketMinUsList]);

    const handleAnnotationClick = useCallback(
        (event: Readonly<ClickAnnotationEvent>) => {
            const entry = histogramData.buckets[event.index];

            if (!entry || entry.totalCount === 0) {
                return;
            }

            prefilterPerfTableByDurationBucket(entry.bucket.minUs);
        },
        [histogramData.buckets, prefilterPerfTableByDurationBucket],
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

    // Memoized because PerfChart derives the Plotly layout from it, and Plotly diffs layout
    // by reference — a fresh object here redraws the chart on every PerfReport render.
    const configuration = useMemo<PlotConfiguration>(
        () => ({
            margin: {
                l: 50,
                r: 0,
                b: 80,
                t: 0,
            },
            barMode: 'stack',
            showLegend: false,
            annotations: bucketAnnotations,
            xAxis: {
                title: {
                    text: 'Device time',
                    standoff: PERF_DURATION_BUCKET_AXIS_TITLE_STANDOFF,
                },
                // The bucket annotations carry the range labels, so ticks would duplicate them
                showticklabels: false,
            },
            yAxis: {
                title: {
                    text: 'Op count',
                },
            },
        }),
        [bucketAnnotations],
    );

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
                        onAnnotationClick={handleAnnotationClick}
                        hints={CHART_HINTS}
                    />
                </div>
            )}
        </div>
    );
}

export default PerfDurationHistogram;
