// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
    ComparisonReportCountBucket,
    DrilldownTarget,
    EventLogEvent,
    FilterSurface,
    MlirFileFormat,
    NpeMode,
    PerfChartLabel,
    PerfTableOption,
    RemoteConnectionTestResult,
} from '../definitions/EventLogEvent';
import { PerfChartId } from '../definitions/PerformanceCharts';
import { ConnectionStatus, ConnectionTestStates, RemoteConnectionFailureReason } from '../definitions/ConnectionStatus';
import recordEvent from './recordEvent';

/**
 * Recorders for the per-surface usage events (#1837).
 *
 * Call a control-driven event's recorder from the handler of the deliberate action, never
 * from an effect on state: several of the states involved are persisted or written by
 * code, and an effect would count a load or a reset as use. Two events are tied to what is
 * shown rather than to a control, and are the only exceptions:
 *
 * - `perf_chart_viewed` follows the scroll position, so it is recorded from an effect on
 *   the Charts tab's active section, once per chart per visit.
 * - `drilldown_opened` with `buffer_details` is recorded wherever a buffer is focused,
 *   which includes the navigation a "Buffer details" link starts, so a reload that
 *   restores that navigation records it again.
 *
 * Follow one of those only for an event that is likewise about what is shown, and say so
 * in its docs section. None may run per frame, per render or per row.
 */

// Exhaustive, so a new chart fails type-checking until it is given an exported label.
const PERF_CHART_BY_CHART_ID: Readonly<Record<PerfChartId, PerfChartLabel>> = Object.freeze({
    [PerfChartId.OpDurationHistogram]: PerfChartLabel.OP_DURATION_HISTOGRAM,
    [PerfChartId.OpCountVsRuntime]: PerfChartLabel.OP_COUNT_VS_RUNTIME,
    [PerfChartId.CoreCountKernelRuntime]: PerfChartLabel.CORE_COUNT_KERNEL_RUNTIME,
    [PerfChartId.KernelDurationVsCoreCount]: PerfChartLabel.KERNEL_DURATION_VS_CORE_COUNT,
    [PerfChartId.MatmulCoreCountUtilization]: PerfChartLabel.MATMUL_CORE_COUNT_UTILIZATION,
    [PerfChartId.MatmulDeviceTime]: PerfChartLabel.MATMUL_DEVICE_TIME,
    [PerfChartId.MatmulKernelDurationUtilization]: PerfChartLabel.MATMUL_KERNEL_DURATION_UTILIZATION,
    [PerfChartId.MatmulUtilizationVsKernelDuration]: PerfChartLabel.MATMUL_UTILIZATION_VS_KERNEL_DURATION,
    [PerfChartId.ConvCoreCountUtilization]: PerfChartLabel.CONV_CORE_COUNT_UTILIZATION,
    [PerfChartId.ConvDeviceTime]: PerfChartLabel.CONV_DEVICE_TIME,
    [PerfChartId.ConvKernelDurationUtilization]: PerfChartLabel.CONV_KERNEL_DURATION_UTILIZATION,
    [PerfChartId.ConvUtilizationVsKernelDuration]: PerfChartLabel.CONV_UTILIZATION_VS_KERNEL_DURATION,
    [PerfChartId.OperationTypes]: PerfChartLabel.OPERATION_TYPES,
});

const PERF_CHART_IDS = new Set<string>(Object.values(PerfChartId));

const MLIR_FILE_FORMAT_BY_EXTENSION: ReadonlyMap<string, MlirFileFormat> = new Map(
    Object.values(MlirFileFormat)
        .filter((format) => format !== MlirFileFormat.OTHER)
        .map((format) => [`.${format}`, format]),
);

// Bucket upper bounds, inclusive. Anything above the last is `THREE_OR_MORE`.
const ONE_COMPARISON_REPORT = 1;
const TWO_COMPARISON_REPORTS = 2;

/**
 * The exported chart for a chart section's DOM id, or `null` for an id that is not a chart.
 *
 * Operation Types renders one section per report, with an `-active` or `-comparison-<n>`
 * suffix (`getOperationTypesChartId`), so it is matched by prefix rather than exactly.
 */
export function getPerfChartForChartId(chartId: string): PerfChartLabel | null {
    if (PERF_CHART_IDS.has(chartId)) {
        return PERF_CHART_BY_CHART_ID[chartId as PerfChartId];
    }

    if (chartId.startsWith(`${PerfChartId.OperationTypes}-`)) {
        return PerfChartLabel.OPERATION_TYPES;
    }

    return null;
}

/**
 * A comparison's size, bucketed so no raw count is ever recorded, or `null` when there is no
 * comparison to count: an empty one is not a use.
 */
export function getComparisonReportCountBucket(comparisonReportCount: number): ComparisonReportCountBucket | null {
    if (comparisonReportCount < ONE_COMPARISON_REPORT) {
        return null;
    }

    if (comparisonReportCount === ONE_COMPARISON_REPORT) {
        return ComparisonReportCountBucket.ONE;
    }

    if (comparisonReportCount === TWO_COMPARISON_REPORTS) {
        return ComparisonReportCountBucket.TWO;
    }

    return ComparisonReportCountBucket.THREE_OR_MORE;
}

/**
 * The format of an MLIR input, from the name of the file the user uploaded.
 *
 * Exact match on the final extension, so `.mlirbc` is never read as `.mlir`. Pass the
 * original upload name, never the converted graph's, which is always `.json`.
 */
export function getMlirFileFormat(filename: string): MlirFileFormat {
    const extensionStart = filename.lastIndexOf('.');

    if (extensionStart < 0) {
        return MlirFileFormat.OTHER;
    }

    return MLIR_FILE_FORMAT_BY_EXTENSION.get(filename.slice(extensionStart).toLowerCase()) ?? MlirFileFormat.OTHER;
}

const REMOTE_CONNECTION_TEST_RESULT_BY_REASON: Readonly<
    Record<RemoteConnectionFailureReason, RemoteConnectionTestResult>
> = Object.freeze({
    [RemoteConnectionFailureReason.AUTH_FAILED]: RemoteConnectionTestResult.AUTH_FAILED,
    [RemoteConnectionFailureReason.HOST_KEY_REJECTED]: RemoteConnectionTestResult.HOST_KEY_REJECTED,
    [RemoteConnectionFailureReason.UNREACHABLE]: RemoteConnectionTestResult.UNREACHABLE,
});

/**
 * The outcome of a remote connection test, from its status lines alone — never their
 * messages, which name the host. The first line is the SSH connection; each later one is a
 * configured report path.
 *
 * In order: a classified failure; SSH up but a path failed; a path with no reports (the
 * only line the server marks `WARNING`); everything OK; anything else is `OTHER`.
 */
export function getRemoteConnectionTestResult(statuses: readonly ConnectionStatus[]): RemoteConnectionTestResult {
    const classified = statuses.find((line) => line.reason);

    if (classified?.reason) {
        return REMOTE_CONNECTION_TEST_RESULT_BY_REASON[classified.reason] ?? RemoteConnectionTestResult.OTHER;
    }

    const [connectionLine, ...pathLines] = statuses;

    if (connectionLine?.status === ConnectionTestStates.OK) {
        if (pathLines.some((line) => line.status === ConnectionTestStates.FAILED)) {
            return RemoteConnectionTestResult.REPORT_PATH_FAILED;
        }

        if (pathLines.some((line) => line.status === ConnectionTestStates.WARNING)) {
            return RemoteConnectionTestResult.NO_REPORTS_FOUND;
        }

        if (pathLines.every((line) => line.status === ConnectionTestStates.OK)) {
            return RemoteConnectionTestResult.SUCCESS;
        }
    }

    return RemoteConnectionTestResult.OTHER;
}

export function recordPerfChartViewed(chart: PerfChartLabel): void {
    recordEvent({ event: EventLogEvent.PERF_CHART_VIEWED, details: { perf_chart: chart } });
}

export function recordPerfTableOptionToggled(option: PerfTableOption): void {
    recordEvent({ event: EventLogEvent.PERF_TABLE_OPTION_TOGGLED, details: { perf_table_option: option } });
}

/** Records nothing for an empty comparison, which `getComparisonReportCountBucket` refuses. */
export function recordPerfComparisonUsed(comparisonReportCount: number): void {
    const bucket = getComparisonReportCountBucket(comparisonReportCount);

    if (bucket === null) {
        return;
    }

    recordEvent({ event: EventLogEvent.PERF_COMPARISON_USED, details: { report_count_bucket: bucket } });
}

export function recordNpePlaybackStarted(): void {
    recordEvent({ event: EventLogEvent.NPE_PLAYBACK_STARTED, details: {} });
}

export function recordNpeModeChanged(mode: NpeMode): void {
    recordEvent({ event: EventLogEvent.NPE_MODE_CHANGED, details: { npe_mode: mode } });
}

export function recordMlirFileLoaded(filename: string): void {
    recordEvent({ event: EventLogEvent.MLIR_FILE_LOADED, details: { mlir_format: getMlirFileFormat(filename) } });
}

export function recordMlirSplitViewUsed(): void {
    recordEvent({ event: EventLogEvent.MLIR_SPLIT_VIEW_USED, details: {} });
}

export function recordDrilldownOpened(target: DrilldownTarget): void {
    recordEvent({ event: EventLogEvent.DRILLDOWN_OPENED, details: { drilldown_target: target } });
}

export function recordFilterUsed(surface: FilterSurface): void {
    recordEvent({ event: EventLogEvent.FILTER_USED, details: { filter_surface: surface } });
}

export function recordRemoteConnectionTest(result: RemoteConnectionTestResult): void {
    recordEvent({ event: EventLogEvent.REMOTE_CONNECTION_TEST, details: { connection_test_result: result } });
}
