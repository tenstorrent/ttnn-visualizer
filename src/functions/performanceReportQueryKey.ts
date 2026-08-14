// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { StackedGroupBy } from '../definitions/StackedPerfTable';
import { Signpost } from '../model/Signpost';

/** Every filter the `perf-results/report` request varies on. */
export interface PerformanceReportParams {
    startSignpost: Signpost | null;
    endSignpost: Signpost | null;
    hideHostOps: boolean;
    mergeDevices: boolean;
    tracingMode: boolean;
    groupBy: StackedGroupBy;
}

/**
 * @description The filters the memory<->performance match needs held still:
 * one row per operation, host ops out of the way, and the whole run rather
 * than a signpost window. `groupBy` only selects the stacked report's shape and
 * cannot affect `report` at all, but it belongs here too — it is part of the
 * query key, so following the tab's grouping control would blank the link
 * report on every switch, which is the failure this exists to prevent (#1812).
 *
 * Every value is the performance tab's own default, so while the tab sits at
 * those defaults link resolution shares its cache entry and costs nothing. Move
 * the tab off any of them — a signpost window, devices unmerged, host ops shown,
 * or the stacked grouping switched — and the two keys diverge into a second
 * `perf-results/report` request. That is not a cheap duplicate: report
 * generation is uncached server-side and CPU-bound, so the fix is to memoise it
 * there, not to unpin these filters.
 */
export const LINKED_PERFORMANCE_REPORT_FILTERS = {
    startSignpost: null,
    endSignpost: null,
    hideHostOps: true,
    mergeDevices: true,
    groupBy: StackedGroupBy.OP,
} as const;

const getSignpostKey = (label: string, signpost: Signpost | null) =>
    `${label}:${signpost ? `${signpost.id}:${signpost.op_code}` : null}`;

// Shared by the single-report and comparison queries so the two can't drift into
// keying on different filters.
const getFilterKeySegments = ({
    startSignpost,
    endSignpost,
    hideHostOps,
    mergeDevices,
    tracingMode,
    groupBy,
}: PerformanceReportParams): string[] => [
    getSignpostKey('startSignpost', startSignpost),
    getSignpostKey('endSignpost', endSignpost),
    `hideHostOps:${hideHostOps ? 'true' : 'false'}`,
    `mergeDevices:${mergeDevices ? 'true' : 'false'}`,
    `tracingMode:${tracingMode ? 'true' : 'false'}`,
    `groupBy:${groupBy}`,
];

export const getPerformanceReportQueryKey = (name: string | null, params: PerformanceReportParams) => [
    'get-performance-report',
    name,
    ...getFilterKeySegments(params),
];

export const getPerformanceComparisonReportQueryKey = (names: string[] | null, params: PerformanceReportParams) => [
    'get-performance-comparison-report',
    names,
    ...getFilterKeySegments(params),
];
