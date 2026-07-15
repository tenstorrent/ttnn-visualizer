// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { PlotData } from 'plotly.js';
import { Marker, TypedPerfTableRow } from '../../definitions/PerfTable';
import {
    MAX_LEGEND_OP_CODES,
    OTHER_OP_CODE_COLOUR,
    OTHER_OP_CODE_LABEL,
    SAMPLE_OPS_PER_BUCKET,
} from '../../definitions/PerfDurationHistogram';
import { OnOpCodeClick, PERF_CHART_LABELS, PerfChartId } from '../../definitions/PerformanceCharts';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';
import { TEST_IDS } from '../../definitions/TestIds';
import buildDurationHistogram from '../../functions/buildDurationHistogram';
import {
    getDisplayedHistogramOpCodes,
    getRolledUpHistogramOpCodes,
} from '../../functions/getDisplayedHistogramOpCodes';
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
        () => new Map(selectedOpCodes.map((marker) => [marker.opCode, marker.colour])),
        [selectedOpCodes],
    );

    const displayedOpCodes = useMemo(() => getDisplayedHistogramOpCodes(histogramData), [histogramData]);
    const rolledUpOpCodes = useMemo(
        () => getRolledUpHistogramOpCodes(histogramData, displayedOpCodes),
        [displayedOpCodes, histogramData],
    );

    const chartData = useMemo(() => {
        const segmentMaps = histogramData.buckets.map(
            (bucket) => new Map(bucket.segmentsByOpCode.map((segment) => [segment.rawOpCode, segment])),
        );

        return displayedOpCodes.map((rawOpCode) => {
            const isOther = rawOpCode === OTHER_OP_CODE_LABEL;

            const customData: DurationHistogramCustomData[] = histogramData.buckets.map((bucket, bucketIndex) => {
                if (isOther) {
                    const otherSegments = [...rolledUpOpCodes].flatMap(
                        (opCode) => segmentMaps[bucketIndex].get(opCode)?.sampleOps ?? [],
                    );
                    const sampleOpsSummary = otherSegments.slice(0, SAMPLE_OPS_PER_BUCKET).join(', ') || '—';

                    return ['', bucket.totalCount, sampleOpsSummary];
                }

                const segment = segmentMaps[bucketIndex].get(rawOpCode);
                const sampleOpsSummary = (segment?.sampleOps ?? []).join(', ') || '—';

                return [rawOpCode, bucket.totalCount, sampleOpsSummary];
            });

            return {
                x: bucketLabels,
                y: histogramData.buckets.map((_, bucketIndex) => {
                    if (isOther) {
                        let otherCount = 0;
                        rolledUpOpCodes.forEach((opCode) => {
                            otherCount += segmentMaps[bucketIndex].get(opCode)?.count ?? 0;
                        });
                        return otherCount;
                    }

                    return segmentMaps[bucketIndex].get(rawOpCode)?.count ?? 0;
                }),
                type: 'bar',
                name: rawOpCode,
                customdata: customData as unknown as PlotData['customdata'],
                hovertemplate:
                    '%{x}<br />%{fullData.name}: %{y}<br />Bucket total: %{customdata[1]}<br />Samples: %{customdata[2]}<extra></extra>',
                marker: {
                    color: isOther ? OTHER_OP_CODE_COLOUR : colourByOpCode.get(rawOpCode),
                },
            } as Partial<PlotData>;
        });
    }, [bucketLabels, colourByOpCode, displayedOpCodes, histogramData.buckets, rolledUpOpCodes]);

    const configuration: PlotConfiguration = {
        margin: {
            l: 50,
            r: 0,
            b: 80,
            t: 0,
        },
        barMode: 'stack',
        showLegend: displayedOpCodes.length <= MAX_LEGEND_OP_CODES,
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
    const subtitle = hasComparisonReports ? 'Active report only' : undefined;

    if (histogramData.buckets.length === 0) {
        return (
            <div
                className='perf-duration-histogram-chart'
                aria-label='Op duration distribution'
            >
                <PerfChartFrame
                    id={PerfChartId.OpDurationHistogram}
                    title={title}
                    subtitle={subtitle}
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
                    subtitle={subtitle}
                    chartData={chartData}
                    configuration={configuration}
                    onPlotClick={onOpCodeClick ? handlePlotClick : undefined}
                />
            </div>
        </div>
    );
}

export default PerfDurationHistogram;
