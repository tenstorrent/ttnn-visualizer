// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Annotation mode for top-N op highlighting on the Buffer Summary view.
 * String-valued because the selected mode persists to `localStorage` through
 * `atomWithStorage` and crosses the JSON-serialisation boundary.
 *
 * All `PERF_*` modes share a single underlying source (the perf report) and
 * resolve their availability against it, but each mode now resolves its own
 * status independently — the perf report can populate `device_time` while
 * leaving `op_to_op_gap` empty, so per-metric `NO_DATA` is a real outcome.
 * `L1_FULLNESS` is independently keyed against the L1 pressure pipeline.
 */
export enum TopNAnnotationMode {
    PERF_TIME = 'perfTime',
    PERF_OP_TO_OP_GAP = 'perfOpToOpGap',
    PERF_DRAM_PERCENT = 'perfDramPercent',
    PERF_FLOPS_PERCENT = 'perfFlopsPercent',
    L1_FULLNESS = 'l1Fullness',
}

/**
 * Availability for a top-N annotation mode. Mirrors the `PerfOverlayStatus`
 * shape used by the operation-graph perf overlay so the disabled-switch +
 * tooltip UX reads consistently across the two surfaces, but extends it
 * with `NO_DATA` so per-metric gaps (e.g. a perf report that doesn't
 * populate `op_to_op_gap`) can be distinguished from "no report loaded".
 *
 * `UNAVAILABLE` — the required source report isn't present (e.g. no perf
 *   report loaded for the perf modes, no profiler report for `L1_FULLNESS`).
 * `UNLINKED` — source report is loaded but doesn't line up with the active
 *   profiler report (mismatched op-id space — same case
 *   `useGetDeviceOperationListPerf` returns `[]`).
 * `NO_DATA` — source report is loaded *and* linked, but no row contributes a
 *   usable value for this specific metric. The perf-report side can produce
 *   this independently per column (e.g. kernel duration is populated but
 *   op-to-op gap is all zero / empty), so each perf mode resolves its own
 *   `NO_DATA` rather than sharing the perf-level state.
 * `READY` — source data is loaded, linked, and has at least one candidate
 *   value for this metric; annotations can be computed.
 */
export enum TopNAnnotationStatus {
    UNAVAILABLE = 'unavailable',
    UNLINKED = 'unlinked',
    NO_DATA = 'noData',
    READY = 'ready',
}

/** Sensible default for the numeric input. Bumped here, picked up by the atom default. */
export const DEFAULT_TOP_N_COUNT = 10;

/** Inclusive bounds on the numeric input; chosen so the rail stays legible without scrolling. */
export const TOP_N_COUNT_MIN = 1;
export const TOP_N_COUNT_MAX = 50;
