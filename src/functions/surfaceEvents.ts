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
    PerfChart,
    PerfTableOption,
    RemoteConnectionTestResult,
} from '../definitions/EventLogEvent';
import { PerfChartId } from '../definitions/PerformanceCharts';
import recordEvent from './recordEvent';

/**
 * Recorders for the per-surface usage events (#1837).
 *
 * Call these from the handler of a deliberate user action, never from an effect on state:
 * several of the states involved are persisted or written by code, and an effect would
 * count a load or a reset as use. None may run per frame, per render or per row.
 */

// Exhaustive, so a new chart fails type-checking until it is given an exported label.
const PERF_CHART_BY_CHART_ID: Readonly<Record<PerfChartId, PerfChart>> = Object.freeze({
    [PerfChartId.OpDurationHistogram]: PerfChart.OP_DURATION_HISTOGRAM,
    [PerfChartId.OpCountVsRuntime]: PerfChart.OP_COUNT_VS_RUNTIME,
    [PerfChartId.CoreCountKernelRuntime]: PerfChart.CORE_COUNT_KERNEL_RUNTIME,
    [PerfChartId.KernelDurationVsCoreCount]: PerfChart.KERNEL_DURATION_VS_CORE_COUNT,
    [PerfChartId.MatmulCoreCountUtilization]: PerfChart.MATMUL_CORE_COUNT_UTILIZATION,
    [PerfChartId.MatmulDeviceTime]: PerfChart.MATMUL_DEVICE_TIME,
    [PerfChartId.MatmulKernelDurationUtilization]: PerfChart.MATMUL_KERNEL_DURATION_UTILIZATION,
    [PerfChartId.MatmulUtilizationVsKernelDuration]: PerfChart.MATMUL_UTILIZATION_VS_KERNEL_DURATION,
    [PerfChartId.ConvCoreCountUtilization]: PerfChart.CONV_CORE_COUNT_UTILIZATION,
    [PerfChartId.ConvDeviceTime]: PerfChart.CONV_DEVICE_TIME,
    [PerfChartId.ConvKernelDurationUtilization]: PerfChart.CONV_KERNEL_DURATION_UTILIZATION,
    [PerfChartId.ConvUtilizationVsKernelDuration]: PerfChart.CONV_UTILIZATION_VS_KERNEL_DURATION,
    [PerfChartId.OperationTypes]: PerfChart.OPERATION_TYPES,
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
export function getPerfChartForChartId(chartId: string): PerfChart | null {
    if (PERF_CHART_IDS.has(chartId)) {
        return PERF_CHART_BY_CHART_ID[chartId as PerfChartId];
    }

    if (chartId.startsWith(`${PerfChartId.OperationTypes}-`)) {
        return PerfChart.OPERATION_TYPES;
    }

    return null;
}

/** Comparison reports besides the active one, bucketed so no raw count is ever recorded. */
export function getComparisonReportCountBucket(reportCount: number): ComparisonReportCountBucket {
    if (reportCount <= ONE_COMPARISON_REPORT) {
        return ComparisonReportCountBucket.ONE;
    }

    if (reportCount === TWO_COMPARISON_REPORTS) {
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

export function recordPerfChartViewed(chart: PerfChart): void {
    recordEvent({ event: EventLogEvent.PERF_CHART_VIEWED, details: { chart } });
}

export function recordPerfTableOptionToggled(option: PerfTableOption): void {
    recordEvent({ event: EventLogEvent.PERF_TABLE_OPTION_TOGGLED, details: { option } });
}

export function recordPerfComparisonUsed(reportCount: number): void {
    recordEvent({
        event: EventLogEvent.PERF_COMPARISON_USED,
        details: { report_count_bucket: getComparisonReportCountBucket(reportCount) },
    });
}

export function recordNpePlaybackStarted(): void {
    recordEvent({ event: EventLogEvent.NPE_PLAYBACK_STARTED, details: {} });
}

export function recordNpeModeChanged(mode: NpeMode): void {
    recordEvent({ event: EventLogEvent.NPE_MODE_CHANGED, details: { mode } });
}

export function recordMlirFileLoaded(filename: string): void {
    recordEvent({ event: EventLogEvent.MLIR_FILE_LOADED, details: { format: getMlirFileFormat(filename) } });
}

export function recordMlirSplitViewUsed(): void {
    recordEvent({ event: EventLogEvent.MLIR_SPLIT_VIEW_USED, details: {} });
}

export function recordDrilldownOpened(target: DrilldownTarget): void {
    recordEvent({ event: EventLogEvent.DRILLDOWN_OPENED, details: { target } });
}

export function recordFilterUsed(surface: FilterSurface): void {
    recordEvent({ event: EventLogEvent.FILTER_USED, details: { surface } });
}

export function recordRemoteConnectionTest(result: RemoteConnectionTestResult): void {
    recordEvent({ event: EventLogEvent.REMOTE_CONNECTION_TEST, details: { result } });
}
