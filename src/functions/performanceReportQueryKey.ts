// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { StackedGroupBy } from '../definitions/StackedPerfTable';
import { Signpost } from '../model/Signpost';

/** Everything the `perf-results/report` endpoint varies its rows on. */
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
 * than a signpost window. These are also the performance tab's own defaults,
 * so a report fetched for link resolution normally shares the tab's cache
 * entry rather than costing a second request (#1812).
 */
export const LINKED_PERFORMANCE_REPORT_FILTERS = {
    startSignpost: null,
    endSignpost: null,
    hideHostOps: true,
    mergeDevices: true,
} as const;

const getSignpostKey = (label: string, signpost: Signpost | null) =>
    `${label}:${signpost ? `${signpost.id}${signpost.op_code}` : null}`;

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
