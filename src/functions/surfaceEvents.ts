// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
    ComparisonReportCountBucket,
    DrilldownTarget,
    EventLogEvent,
    FilterSurface,
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
 * code, and an effect would count a load or a reset as use. One event is tied to what is
 * shown rather than to a control, and is the only exception: `perf_chart_viewed` follows
 * the scroll position, so it is recorded from an effect on the sections the Charts tab's
 * scroll-spy reports in view: the active one, and at the bottom of the page every one whose
 * top is in view. Once per chart per visit.
 *
 * Follow it only for an event that is likewise about what is shown, and say so in its docs
 * section and in the docs' "Per-surface events" intro, which lists every exception too.
 * None may run per frame, per render or per row.
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

const OPERATION_TYPES_CHART_ID_PREFIX = `${PerfChartId.OperationTypes}-`;

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

    // A suffix is required: the bare prefix is no report's section.
    if (
        chartId.startsWith(OPERATION_TYPES_CHART_ID_PREFIX) &&
        chartId.length > OPERATION_TYPES_CHART_ID_PREFIX.length
    ) {
        return PerfChartLabel.OPERATION_TYPES;
    }

    return null;
}

/**
 * A comparison's size, bucketed so no raw count is ever recorded, or `null` when there is no
 * comparison to count: an empty one is not a use, and a count that is not a whole number of
 * reports is no comparison at all. The buckets are the enum's own: one, two, then the rest.
 */
export function getComparisonReportCountBucket(comparisonReportCount: number): ComparisonReportCountBucket | null {
    if (!Number.isInteger(comparisonReportCount) || comparisonReportCount < 1) {
        return null;
    }

    if (comparisonReportCount === 1) {
        return ComparisonReportCountBucket.ONE;
    }

    if (comparisonReportCount === 2) {
        return ComparisonReportCountBucket.TWO;
    }

    return ComparisonReportCountBucket.THREE_OR_MORE;
}

type ConnectionFailureReason = Exclude<RemoteConnectionFailureReason, RemoteConnectionFailureReason.REPORT_PATH_FAILED>;

// The reasons that are about the connection rather than one path, so they decide the
// result from any line. `REPORT_PATH_FAILED` is the path's own and is read below. Keyed by
// every other reason, so a new one fails type-checking until it is given a result here.
const REMOTE_CONNECTION_TEST_RESULT_BY_CONNECTION_REASON: Readonly<
    Record<ConnectionFailureReason, RemoteConnectionTestResult>
> = Object.freeze({
    [RemoteConnectionFailureReason.AUTH_FAILED]: RemoteConnectionTestResult.AUTH_FAILED,
    [RemoteConnectionFailureReason.HOST_KEY_REJECTED]: RemoteConnectionTestResult.HOST_KEY_REJECTED,
    [RemoteConnectionFailureReason.UNREACHABLE]: RemoteConnectionTestResult.UNREACHABLE,
});

// An own-property check, so a reason such as "constructor" never resolves through the prototype.
const isConnectionFailureReason = (reason: string): reason is ConnectionFailureReason =>
    Object.hasOwn(REMOTE_CONNECTION_TEST_RESULT_BY_CONNECTION_REASON, reason);

const getConnectionReasonResult = (line: ConnectionStatus): RemoteConnectionTestResult | undefined =>
    line.reason && isConnectionFailureReason(line.reason)
        ? REMOTE_CONNECTION_TEST_RESULT_BY_CONNECTION_REASON[line.reason]
        : undefined;

/**
 * The outcome of a remote connection test, from its status lines alone — never their
 * messages, which name the host. The first line is the SSH connection; each later one is a
 * configured report path.
 *
 * In order: a connection failure classified by its line's reason, on any line; SSH up and
 * a path the server marked as the problem; any other failed path, which nobody classified,
 * is `OTHER`; a path with no reports (the only line the server marks `WARNING`); everything
 * OK. Anything else is `OTHER`, so a failure the server does not classify can never be
 * counted as a misconfigured path. A test always sends at least one path, so a lone OK line
 * is not a success.
 */
export function getRemoteConnectionTestResult(statuses: readonly ConnectionStatus[]): RemoteConnectionTestResult {
    const connectionResult = statuses.map(getConnectionReasonResult).find(Boolean);

    if (connectionResult) {
        return connectionResult;
    }

    const [connectionLine, ...pathLines] = statuses;

    if (connectionLine?.status === ConnectionTestStates.OK && pathLines.length > 0) {
        if (pathLines.some((line) => line.reason === RemoteConnectionFailureReason.REPORT_PATH_FAILED)) {
            return RemoteConnectionTestResult.REPORT_PATH_FAILED;
        }

        if (pathLines.some((line) => line.status === ConnectionTestStates.FAILED)) {
            return RemoteConnectionTestResult.OTHER;
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

export function recordDrilldownOpened(target: DrilldownTarget): void {
    recordEvent({ event: EventLogEvent.DRILLDOWN_OPENED, details: { drilldown_target: target } });
}

export function recordFilterUsed(surface: FilterSurface): void {
    recordEvent({ event: EventLogEvent.FILTER_USED, details: { filter_surface: surface } });
}

export function recordRemoteConnectionTest(result: RemoteConnectionTestResult): void {
    recordEvent({ event: EventLogEvent.REMOTE_CONNECTION_TEST, details: { connection_test_result: result } });
}
