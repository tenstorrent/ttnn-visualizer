// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ComparisonReportCountBucket,
    DrilldownTarget,
    EventLogEvent,
    FilterSurface,
    NpeMode,
    PerfChartLabel,
    PerfTableOption,
    RemoteConnectionTestResult,
} from '../src/definitions/EventLogEvent';
import { PerfChartId } from '../src/definitions/PerformanceCharts';
import { getOperationTypesChartId } from '../src/functions/buildChartIndexEntries';
import {
    getComparisonReportCountBucket,
    getPerfChartForChartId,
    recordDrilldownOpened,
    recordFilterUsed,
    recordNpeModeChanged,
    recordNpePlaybackStarted,
    recordPerfChartViewed,
    recordPerfComparisonUsed,
    recordPerfTableOptionToggled,
    recordRemoteConnectionTest,
} from '../src/functions/surfaceEvents';

const { recordEvent } = vi.hoisted(() => ({ recordEvent: vi.fn() }));

vi.mock('../src/functions/recordEvent', () => ({ default: recordEvent }));

beforeEach(() => {
    vi.clearAllMocks();
});

describe('getPerfChartForChartId', () => {
    it.each(Object.values(PerfChartId))("labels %s by its own id, not another chart's", (chartId) => {
        // A swapped pair passes a distinctness check, and two charts share a title.
        expect(getPerfChartForChartId(chartId)).toBe(chartId.replace(/^perf-chart-/, '').replaceAll('-', '_'));
    });

    it('labels every chart, each with a label of its own', () => {
        const labels = Object.values(PerfChartId).map(getPerfChartForChartId);

        expect(new Set(labels)).toEqual(new Set(Object.values(PerfChartLabel)));
    });

    it('maps the per-report Operation Types sections to one chart', () => {
        expect(getPerfChartForChartId(getOperationTypesChartId('active'))).toBe(PerfChartLabel.OPERATION_TYPES);
        expect(getPerfChartForChartId(getOperationTypesChartId('comparison-2'))).toBe(PerfChartLabel.OPERATION_TYPES);
    });

    it('returns null for an id that is not a chart', () => {
        expect(getPerfChartForChartId('buffer-summary-plot')).toBeNull();
        expect(getPerfChartForChartId('perf-chart-operation-typesX')).toBeNull();
        // The bare prefix is no report's section: every one carries a suffix.
        expect(getPerfChartForChartId(`${PerfChartId.OperationTypes}-`)).toBeNull();
    });
});

describe('getComparisonReportCountBucket', () => {
    it.each([
        [-1, null],
        [0, null],
        [1, ComparisonReportCountBucket.ONE],
        [2, ComparisonReportCountBucket.TWO],
        [3, ComparisonReportCountBucket.THREE_OR_MORE],
        [7, ComparisonReportCountBucket.THREE_OR_MORE],
        // Not a whole number of reports, so not a comparison to count.
        [Number.NaN, null],
        [1.5, null],
    ])('buckets %d comparison reports as %s', (reportCount, bucket) => {
        expect(getComparisonReportCountBucket(reportCount)).toBe(bucket);
    });
});

describe('recorders', () => {
    const recorderCases: [() => void, { event: EventLogEvent; details: object }][] = [
        [
            () => recordPerfChartViewed(PerfChartLabel.MATMUL_DEVICE_TIME),
            { event: EventLogEvent.PERF_CHART_VIEWED, details: { perf_chart: PerfChartLabel.MATMUL_DEVICE_TIME } },
        ],
        [
            () => recordPerfTableOptionToggled(PerfTableOption.TRACING_MODE),
            {
                event: EventLogEvent.PERF_TABLE_OPTION_TOGGLED,
                details: { perf_table_option: PerfTableOption.TRACING_MODE },
            },
        ],
        [
            () => recordPerfComparisonUsed(4),
            {
                event: EventLogEvent.PERF_COMPARISON_USED,
                details: { report_count_bucket: ComparisonReportCountBucket.THREE_OR_MORE },
            },
        ],
        [() => recordNpePlaybackStarted(), { event: EventLogEvent.NPE_PLAYBACK_STARTED, details: {} }],
        [
            () => recordNpeModeChanged(NpeMode.CYCLES_SCALE),
            { event: EventLogEvent.NPE_MODE_CHANGED, details: { npe_mode: NpeMode.CYCLES_SCALE } },
        ],
        [
            () => recordDrilldownOpened(DrilldownTarget.STACK_TRACE),
            { event: EventLogEvent.DRILLDOWN_OPENED, details: { drilldown_target: DrilldownTarget.STACK_TRACE } },
        ],
        [
            () => recordFilterUsed(FilterSurface.TENSORS),
            { event: EventLogEvent.FILTER_USED, details: { filter_surface: FilterSurface.TENSORS } },
        ],
        [
            () => recordRemoteConnectionTest(RemoteConnectionTestResult.UNREACHABLE),
            {
                event: EventLogEvent.REMOTE_CONNECTION_TEST,
                details: { connection_test_result: RemoteConnectionTestResult.UNREACHABLE },
            },
        ],
    ];

    it.each(recorderCases.map(([record, payload]) => ({ record, payload, event: payload.event })))(
        'posts the wire shape the server validates for $event',
        ({ record, payload }) => {
            record();

            expect(recordEvent).toHaveBeenCalledExactlyOnceWith(payload);
        },
    );

    it('records nothing for an empty comparison', () => {
        recordPerfComparisonUsed(0);

        expect(recordEvent).not.toHaveBeenCalled();
    });
});
