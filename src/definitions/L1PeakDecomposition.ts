// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cssVar } from '../functions/colour';

/** What a resident is, which decides whether anything can be done about it. */
export enum L1ResidentKind {
    CIRCULAR_BUFFER = 'circular-buffer',
    /** Allocated and freed inside one operation — never visible in a post-op snapshot. */
    INTERMEDIATE_TENSOR = 'intermediate-tensor',
    PERSISTENT_TENSOR = 'persistent-tensor',
    /** Still allocated after its last real consumer; the only freeable class. */
    STALE_TENSOR = 'stale-tensor',
}

/**
 * Whether a total is a measurement or a ceiling.
 *
 * Summing per-bank bytes assumes the residents share cores. A `buffer_allocate` node
 * carries only `num_cores`, never which cores (#2027), and this module does not yet
 * resolve a CB's `core_range_set`, so *any* two live residents are added without proof
 * that they stack on one core. Only a single resident is therefore exact.
 */
export enum L1PeakPrecision {
    EXACT = 'exact',
    UPPER_BOUND = 'upper-bound',
}

/**
 * Same four states as `L1PressureStatus`, which is a PascalCase enum this does not copy —
 * new enum members are SCREAMING_SNAKE_CASE. A consumer has to tell "still fetching", "no report",
 * "the fetch failed" and "this report genuinely has no L1" apart, and a bare empty result
 * makes all four look like the last one.
 */
export enum L1PeakStatus {
    UNAVAILABLE = 'unavailable',
    LOADING = 'loading',
    ERROR = 'error',
    READY = 'ready',
}

export const L1_RESIDENT_KIND_LABEL: Readonly<Record<L1ResidentKind, string>> = {
    [L1ResidentKind.CIRCULAR_BUFFER]: 'Circular buffer',
    [L1ResidentKind.INTERMEDIATE_TENSOR]: 'Intermediate',
    [L1ResidentKind.PERSISTENT_TENSOR]: 'Persistent',
    [L1ResidentKind.STALE_TENSOR]: 'Stale',
};

/**
 * Resolved on use, not captured at import: `cssVar` reads the computed style, which is not
 * guaranteed to have applied when this module first evaluates. Same reason
 * `getPerfChartChrome` is a function.
 */
export const getL1PeakColours = (): Readonly<Record<L1ResidentKind | 'capacity', string>> => ({
    [L1ResidentKind.CIRCULAR_BUFFER]: cssVar(`--l1-peak-cb`),
    [L1ResidentKind.INTERMEDIATE_TENSOR]: cssVar(`--l1-peak-intermediate`),
    [L1ResidentKind.PERSISTENT_TENSOR]: cssVar(`--l1-peak-persistent`),
    [L1ResidentKind.STALE_TENSOR]: cssVar(`--l1-peak-stale`),
    capacity: cssVar(`--l1-peak-capacity`),
});

/**
 * Stack order, bottom to top, paired with the field each band reads. Keyed by
 * `L1ResidentKind` so a new class cannot be added to the enum and silently omitted here.
 */
export const L1_PEAK_SERIES: readonly { kind: L1ResidentKind; field: string; label: string }[] = [
    { kind: L1ResidentKind.CIRCULAR_BUFFER, field: 'circularBufferBytes', label: 'Circular buffers' },
    { kind: L1ResidentKind.INTERMEDIATE_TENSOR, field: 'intermediateTensorBytes', label: 'Intermediate tensors' },
    { kind: L1ResidentKind.PERSISTENT_TENSOR, field: 'persistentTensorBytes', label: 'Persistent tensors' },
    { kind: L1ResidentKind.STALE_TENSOR, field: 'staleTensorBytes', label: 'Stale tensors' },
];
