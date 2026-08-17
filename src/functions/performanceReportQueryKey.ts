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
 * `perf-results/report` request.
 *
 * Expect that on the first toggle of any of those controls, not as a rare case:
 * `RangeSlider` is mounted app-wide and subscribes to both queries, so once they
 * diverge the app holds two live report queries for the rest of the session, each
 * retaining a full `PerfTableRow[]` under `staleTime: Infinity`. Report generation
 * is uncached server-side and CPU-bound on a single worker, so the fix is to
 * memoise it there (#1886) rather than to unpin these filters.
 */
export const LINKED_PERFORMANCE_REPORT_FILTERS = {
    startSignpost: null,
    endSignpost: null,
    hideHostOps: true,
    mergeDevices: true,
    groupBy: StackedGroupBy.OP,
} as const;

/**
 * @description The full parameter set link resolution fetches with: every pinned
 * filter, plus the one view control it still follows.
 *
 * Exported so the hook and its tests compose the pinned set the same way. A test
 * that spread `LINKED_PERFORMANCE_REPORT_FILTERS` itself would assert against its
 * own composition, and would keep passing if the hook started pinning
 * `tracingMode` too. The `PerformanceReportParams` return type also makes a new
 * filter added to that interface a compile error until it is either pinned above
 * or forwarded here deliberately.
 */
export const getLinkedPerformanceReportParams = (tracingMode: boolean): PerformanceReportParams => ({
    ...LINKED_PERFORMANCE_REPORT_FILTERS,
    tracingMode,
});

/**
 * @description Whether link resolution ran against the row order the pinned
 * filters describe, rather than the traced order `tracingMode` substitutes.
 *
 * Only callers that *persist* a verdict need this. `reportLinksAtom` is backed by
 * localStorage, so an `UNLINKED` reached with tracing mode on would outlive the
 * toggle that caused it and keep badging the pair as a failed link in the report
 * pickers. A `LINKED` holds under either order, so it is still worth recording
 * (#1812).
 */
export const isLinkResolutionCanonical = (tracingMode: boolean) => !tracingMode;

const getSignpostKey = (label: string, signpost: Signpost | null) =>
    `${label}:${signpost ? `${signpost.id}:${signpost.op_code}` : null}`;

// Shared by the single-report and comparison queries so the two can't drift into
// keying on different filters.
const getFilterKeySegments = (params: PerformanceReportParams): string[] => {
    // Keyed on the interface rather than built as a free-form array: a filter added
    // to `PerformanceReportParams` is a compile error here until it is given a
    // segment. Passing the params as one object stops the request's filters being
    // transposed; this stops one being sent but left out of the key, which caches a
    // request under a key that misdescribes it. Insertion order fixes the segment
    // order, so the keys are unchanged by going through the record.
    const segments: Record<keyof PerformanceReportParams, string> = {
        startSignpost: getSignpostKey('startSignpost', params.startSignpost),
        endSignpost: getSignpostKey('endSignpost', params.endSignpost),
        hideHostOps: `hideHostOps:${params.hideHostOps ? 'true' : 'false'}`,
        mergeDevices: `mergeDevices:${params.mergeDevices ? 'true' : 'false'}`,
        tracingMode: `tracingMode:${params.tracingMode ? 'true' : 'false'}`,
        groupBy: `groupBy:${params.groupBy}`,
    };

    return Object.values(segments);
};

/**
 * @description Report names are bare folder basenames, so two instances can hold
 * different reports under one name — a local copy and a remote-synced copy of the
 * same timestamped run, most obviously. These queries run at `staleTime: Infinity`
 * and report selection does not always clear the cache, so a basename-only key
 * would serve one instance's report as another's. The NPE queries scope their keys
 * for the same reason.
 *
 * Taken as one object rather than positionally: the report name and `instanceId`
 * are adjacent strings, and transposing them would key every report under the
 * instance and vice versa without a type error.
 */
interface PerformanceReportQueryKeyInput {
    instanceId: string;
    params: PerformanceReportParams;
}

export const getPerformanceReportQueryKey = ({
    name,
    instanceId,
    params,
}: PerformanceReportQueryKeyInput & { name: string | null }) => [
    'get-performance-report',
    instanceId,
    name,
    ...getFilterKeySegments(params),
];

export const getPerformanceComparisonReportQueryKey = ({
    names,
    instanceId,
    params,
}: PerformanceReportQueryKeyInput & { names: string[] | null }) => [
    'get-performance-comparison-report',
    instanceId,
    names,
    ...getFilterKeySegments(params),
];
