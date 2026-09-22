// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cssVar } from '../functions/colour';

/** What a resident is, which decides whether anything can be done about it. */
export enum L1ResidentKind {
    CircularBuffer = 'circular-buffer',
    /** Allocated and freed inside one operation — never visible in a post-op snapshot. */
    IntermediateTensor = 'intermediate-tensor',
    PersistentTensor = 'persistent-tensor',
    /** Still allocated after its last real consumer; the only freeable class. */
    StaleTensor = 'stale-tensor',
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
    Exact = 'exact',
    UpperBound = 'upper-bound',
}

/**
 * Mirrors `L1PressureStatus`: a consumer has to tell "still fetching", "no report",
 * "the fetch failed" and "this report genuinely has no L1" apart, and a bare empty result
 * makes all four look like the last one.
 */
export enum L1PeakStatus {
    Unavailable = 'unavailable',
    Loading = 'loading',
    Error = 'error',
    Ready = 'ready',
}

export const L1_RESIDENT_KIND_LABEL: Readonly<Record<L1ResidentKind, string>> = {
    [L1ResidentKind.CircularBuffer]: 'Circular buffer',
    [L1ResidentKind.IntermediateTensor]: 'Intermediate',
    [L1ResidentKind.PersistentTensor]: 'Persistent',
    [L1ResidentKind.StaleTensor]: 'Stale',
};

/**
 * Resolved on use, not captured at import: `cssVar` reads the computed style, which is not
 * guaranteed to have applied when this module first evaluates. Same reason
 * `getPerfChartChrome` is a function.
 */
export const getL1PeakColours = (): Readonly<Record<L1ResidentKind | 'capacity', string>> => ({
    [L1ResidentKind.CircularBuffer]: cssVar(`--l1-peak-cb`),
    [L1ResidentKind.IntermediateTensor]: cssVar(`--l1-peak-intermediate`),
    [L1ResidentKind.PersistentTensor]: cssVar(`--l1-peak-persistent`),
    [L1ResidentKind.StaleTensor]: cssVar(`--l1-peak-stale`),
    capacity: cssVar(`--l1-peak-capacity`),
});

/**
 * Stack order, bottom to top, paired with the field each band reads. Keyed by
 * `L1ResidentKind` so a new class cannot be added to the enum and silently omitted here.
 */
export const L1_PEAK_SERIES: readonly { kind: L1ResidentKind; field: string; label: string }[] = [
    { kind: L1ResidentKind.CircularBuffer, field: 'circularBufferBytes', label: 'Circular buffers' },
    { kind: L1ResidentKind.IntermediateTensor, field: 'intermediateTensorBytes', label: 'Intermediate tensors' },
    { kind: L1ResidentKind.PersistentTensor, field: 'persistentTensorBytes', label: 'Persistent tensors' },
    { kind: L1ResidentKind.StaleTensor, field: 'staleTensorBytes', label: 'Stale tensors' },
];
