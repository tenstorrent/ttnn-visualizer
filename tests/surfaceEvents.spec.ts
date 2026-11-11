// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ComparisonReportCountBucket,
    DrilldownTarget,
    EventLogEvent,
    FilterSurface,
    MlirFileFormat,
    NpeMode,
    PerfChart,
    PerfTableOption,
    RemoteConnectionTestResult,
} from '../src/definitions/EventLogEvent';
import { MLIR_SERVER_ACCEPTED_EXTENSIONS } from '../src/definitions/MlirServer';
import { PerfChartId } from '../src/definitions/PerformanceCharts';
import { getOperationTypesChartId } from '../src/functions/buildChartIndexEntries';
import {
    getComparisonReportCountBucket,
    getMlirFileFormat,
    getPerfChartForChartId,
    recordDrilldownOpened,
    recordFilterUsed,
    recordMlirFileLoaded,
    recordMlirSplitViewUsed,
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
    it('maps every chart id to a distinct exported chart', () => {
        const charts = Object.values(PerfChartId).map(getPerfChartForChartId);

        expect(charts).not.toContain(null);
        expect(new Set(charts).size).toBe(Object.values(PerfChart).length);
    });

    it('maps the per-report Operation Types sections to one chart', () => {
        expect(getPerfChartForChartId(getOperationTypesChartId('active'))).toBe(PerfChart.OPERATION_TYPES);
        expect(getPerfChartForChartId(getOperationTypesChartId('comparison-2'))).toBe(PerfChart.OPERATION_TYPES);
    });

    it('returns null for an id that is not a chart', () => {
        expect(getPerfChartForChartId('buffer-summary-plot')).toBeNull();
        expect(getPerfChartForChartId('perf-chart-operation-typesX')).toBeNull();
    });
});

describe('getComparisonReportCountBucket', () => {
    it.each([
        [1, ComparisonReportCountBucket.ONE],
        [2, ComparisonReportCountBucket.TWO],
        [3, ComparisonReportCountBucket.THREE_OR_MORE],
        [7, ComparisonReportCountBucket.THREE_OR_MORE],
    ])('buckets %i comparison reports as %s', (reportCount, bucket) => {
        expect(getComparisonReportCountBucket(reportCount)).toBe(bucket);
    });
});

describe('getMlirFileFormat', () => {
    it.each(MLIR_SERVER_ACCEPTED_EXTENSIONS)('gives the accepted extension %s its own format', (extension) => {
        expect(getMlirFileFormat(`model${extension}`)).toBe(extension.slice(1));
    });

    it.each([
        ['model.tflite', MlirFileFormat.TFLITE],
        ['MODEL.PT2', MlirFileFormat.PT2],
        ['graph.mlirbc', MlirFileFormat.MLIRBC],
        ['graph.mlir', MlirFileFormat.MLIR],
        ['archive.tar.pb', MlirFileFormat.PB],
        ['notes.txt', MlirFileFormat.OTHER],
        ['no-extension', MlirFileFormat.OTHER],
        ['trailing.', MlirFileFormat.OTHER],
    ])('reads %s as %s', (filename, format) => {
        expect(getMlirFileFormat(filename)).toBe(format);
    });
});

describe('recorders', () => {
    it.each([
        [
            () => recordPerfChartViewed(PerfChart.MATMUL_DEVICE_TIME),
            { event: EventLogEvent.PERF_CHART_VIEWED, details: { chart: PerfChart.MATMUL_DEVICE_TIME } },
        ],
        [
            () => recordPerfTableOptionToggled(PerfTableOption.TRACING_MODE),
            { event: EventLogEvent.PERF_TABLE_OPTION_TOGGLED, details: { option: PerfTableOption.TRACING_MODE } },
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
            { event: EventLogEvent.NPE_MODE_CHANGED, details: { mode: NpeMode.CYCLES_SCALE } },
        ],
        [
            () => recordMlirFileLoaded('resnet.graphdef'),
            { event: EventLogEvent.MLIR_FILE_LOADED, details: { format: MlirFileFormat.GRAPHDEF } },
        ],
        [() => recordMlirSplitViewUsed(), { event: EventLogEvent.MLIR_SPLIT_VIEW_USED, details: {} }],
        [
            () => recordDrilldownOpened(DrilldownTarget.STACK_TRACE),
            { event: EventLogEvent.DRILLDOWN_OPENED, details: { target: DrilldownTarget.STACK_TRACE } },
        ],
        [
            () => recordFilterUsed(FilterSurface.MLIR_OP),
            { event: EventLogEvent.FILTER_USED, details: { surface: FilterSurface.MLIR_OP } },
        ],
        [
            () => recordRemoteConnectionTest(RemoteConnectionTestResult.UNREACHABLE),
            {
                event: EventLogEvent.REMOTE_CONNECTION_TEST,
                details: { result: RemoteConnectionTestResult.UNREACHABLE },
            },
        ],
    ])('posts the wire shape the server validates (%#)', (record, payload) => {
        record();

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith(payload);
    });

    it('never records the MLIR file name itself', () => {
        recordMlirFileLoaded('secret-customer-model.tflite');

        expect(JSON.stringify(recordEvent.mock.calls)).not.toContain('secret-customer-model');
    });
});
