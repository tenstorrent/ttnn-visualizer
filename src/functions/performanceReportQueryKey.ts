// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { ReportLocation } from '../definitions/Reports';
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
 * `tracingMode` is pinned too, though the reason is not the one you would guess
 * from its name. It suppresses a single `sort_values(by="HOST START TS")` in
 * `tt-perf-report` (`perf_report.py:2168`), but merging runs on this path — we
 * pin `mergeDevices: true` — and `merge_device_rows` ends by re-sorting on
 * `ORIGINAL_ROW`, i.e. raw CSV order (`perf_report.py:1947-1949`). So the merge
 * re-sort overwrites the tracing branch, and for a single-device report the row
 * sequence is identical either way. The traced order never reaches link
 * resolution, so following the toggle bought nothing and let a view control move
 * the answer (#1812). Line numbers are against the pinned `tt-perf-report`
 * version in `pyproject.toml`; re-check them when it moves.
 *
 * Every value is the performance tab's own default, so while the tab sits at
 * those defaults link resolution shares its cache entry and costs nothing. Move
 * the tab off any of them — a signpost window, devices unmerged, host ops shown,
 * the stacked grouping switched, or tracing mode on — and the two keys diverge
 * into a second `perf-results/report` request.
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
    tracingMode: false,
    groupBy: StackedGroupBy.OP,
} as const;

/**
 * @description The parameter set link resolution fetches with. Every filter is
 * pinned, so this takes no arguments — no performance-tab control can move it.
 *
 * Exported so the hook and its tests compose the set the same way. A test that
 * spread `LINKED_PERFORMANCE_REPORT_FILTERS` itself would assert against its own
 * composition, and would keep passing if the hook started forwarding a view
 * filter again. The `PerformanceReportParams` return type also makes a new filter
 * added to that interface a compile error until it is pinned above.
 */
export const getLinkedPerformanceReportParams = (): PerformanceReportParams => ({
    ...LINKED_PERFORMANCE_REPORT_FILTERS,
});

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
 * `instanceId` alone does not cover the local/remote pair: it is per browser
 * session, so both selections carry the same one. `location` is what the server
 * actually resolves the name against — `?name=` is joined onto the parent of the
 * instance's `performance_path`, and that parent is the uploads folder for a local
 * report and the synced folder for a remote one — so the same name genuinely
 * addresses two different reports. Selecting a local report does not clear the
 * cache (`LocalFolderSelector`'s select handlers call only `updateInstance`), so
 * without this segment the remote report's rows survive the switch.
 *
 * Taken as one object rather than positionally: the report name and `instanceId`
 * are adjacent strings, and transposing them would key every report under the
 * instance and vice versa without a type error.
 */
interface PerformanceReportQueryKeyInput {
    instanceId: string;
    location: ReportLocation | null;
    params: PerformanceReportParams;
}

export const getPerformanceReportQueryKey = ({
    name,
    instanceId,
    location,
    params,
}: PerformanceReportQueryKeyInput & { name: string | null }) => [
    'get-performance-report',
    instanceId,
    location,
    name,
    ...getFilterKeySegments(params),
];

export const getPerformanceComparisonReportQueryKey = ({
    names,
    instanceId,
    location,
    params,
}: PerformanceReportQueryKeyInput & { names: string[] | null }) => [
    'get-performance-comparison-report',
    instanceId,
    location,
    names,
    ...getFilterKeySegments(params),
];
