// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { OpPerfAggregate } from './perfOverlay';
import { L1PressureMetrics } from './l1Pressure';
import { formatDuration } from './formatting';

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
 * Discriminator for which data pipeline a mode belongs to. Perf modes pull
 * from `perfAggregatesByOpId`; the L1 mode pulls from `l1PressureByOpId`.
 * Kept exported so `useTopNAnnotations` can dispatch without restating the
 * enum check.
 */
export const isPerfMode = (mode: TopNAnnotationMode): boolean => mode !== TopNAnnotationMode.L1_FULLNESS;

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

/**
 * One ranked op annotation. `t` is the colour-ramp position in `[0, 1]`,
 * normalised within the top-N slice (not across all ops) so the badge
 * colours visually distinguish #1 from #N even when the overall distribution
 * dwarfs the highlighted slice.
 *
 * `rowIndex` is the position of the op inside the *rendered* `operations`
 * array passed to `selectTopNAnnotations` — that array may be a filtered or
 * segmented subset (the DRAM tab's zoom segmentation is the main case), so
 * the rail and badge align with what the user actually sees, not with raw
 * op-id ordering.
 */
export interface RankedAnnotation {
    opId: number;
    rowIndex: number;
    rank: number;
    t: number;
    valueLabel: string;
    rawValue: number;
}

interface OperationsLike {
    id: number;
}

export interface SelectTopNParams {
    mode: TopNAnnotationMode;
    n: number;
    operations: readonly OperationsLike[];
    perfAggregatesByOpId?: Map<number, OpPerfAggregate>;
    l1PressureByOpId?: Map<number, L1PressureMetrics>;
}

// Op-id rendered before its metric is computed — sort tiebreaker, deterministic. Always
// resolves to an integer comparison so we never tie-rank two ops with identical metric.
const compareByOpIdAsc = (a: { opId: number }, b: { opId: number }) => a.opId - b.opId;

interface RankedCandidate {
    opId: number;
    rowIndex: number;
    rawValue: number;
}

/**
 * Select the top-N ops by `rawValue` (descending), restricted to ops present
 * in the rendered `operations` array. Ties break on op id ascending so the
 * ordering is deterministic across renders.
 */
const pickTopN = (candidates: RankedCandidate[], n: number): RankedCandidate[] => {
    if (n <= 0 || candidates.length === 0) {
        return [];
    }
    const sorted = [...candidates].sort((a, b) => {
        if (a.rawValue !== b.rawValue) {
            return b.rawValue - a.rawValue;
        }
        return compareByOpIdAsc(a, b);
    });
    return sorted.slice(0, n);
};

/**
 * Normalise log10 over `[min, max]`. Returns `0` for every candidate when
 * `min === max` (no signal to rank by colour); the rank number itself still
 * conveys position.
 */
const normaliseLog10 = (rawValue: number, minValue: number, maxValue: number): number => {
    if (minValue === maxValue || !Number.isFinite(minValue) || minValue <= 0) {
        return 0;
    }
    const logMin = Math.log10(minValue);
    const logMax = Math.log10(maxValue);
    const range = logMax - logMin;
    if (range <= 0) {
        return 0;
    }
    return Math.min(1, Math.max(0, (Math.log10(rawValue) - logMin) / range));
};

/** Linear normalisation over `[min, max]`. Same edge-case rules as `normaliseLog10`. */
const normaliseLinear = (rawValue: number, minValue: number, maxValue: number): number => {
    if (minValue === maxValue) {
        return 0;
    }
    const range = maxValue - minValue;
    if (range <= 0) {
        return 0;
    }
    return Math.min(1, Math.max(0, (rawValue - minValue) / range));
};

const formatPercentLabel = (percent: number): string => `${percent.toFixed(1)}%`;

// Each perf-derived mode points at a single field on `OpPerfAggregate`. The
// extractor isolates the per-mode plumbing so `selectTopNAnnotations` stays
// a single linear pass and adding a new perf metric is just a row here.
interface PerfModeSpec {
    extract: (aggregate: OpPerfAggregate) => number | null;
    formatValueLabel: (rawValue: number) => string;
    /**
     * Log-scale for long-tailed durations (kernel duration, op-to-op gap)
     * so the colour ramp stays meaningful across orders of magnitude;
     * linear for bounded percentages so "twice as utilised" reads as
     * twice as far up the ramp. Mirrors the rationale on the L1 fullness
     * normaliser below.
     */
    normalise: (rawValue: number, minValue: number, maxValue: number) => number;
}

const PERF_MODE_SPEC: Record<Exclude<TopNAnnotationMode, TopNAnnotationMode.L1_FULLNESS>, PerfModeSpec> = {
    [TopNAnnotationMode.PERF_TIME]: {
        extract: (aggregate) => aggregate.deviceTimeNs,
        formatValueLabel: formatDuration,
        normalise: normaliseLog10,
    },
    [TopNAnnotationMode.PERF_OP_TO_OP_GAP]: {
        extract: (aggregate) => aggregate.opToOpGapNs,
        formatValueLabel: formatDuration,
        normalise: normaliseLog10,
    },
    [TopNAnnotationMode.PERF_DRAM_PERCENT]: {
        extract: (aggregate) => aggregate.dramPercent,
        formatValueLabel: formatPercentLabel,
        normalise: normaliseLinear,
    },
    [TopNAnnotationMode.PERF_FLOPS_PERCENT]: {
        extract: (aggregate) => aggregate.flopsPercent,
        formatValueLabel: formatPercentLabel,
        normalise: normaliseLinear,
    },
};

const collectPerfCandidates = (
    operations: readonly OperationsLike[],
    perfAggregatesByOpId: Map<number, OpPerfAggregate>,
    extract: (aggregate: OpPerfAggregate) => number | null,
): RankedCandidate[] => {
    const candidates: RankedCandidate[] = [];
    operations.forEach((operation, rowIndex) => {
        const aggregate = perfAggregatesByOpId.get(operation.id);
        if (!aggregate) {
            return;
        }
        const rawValue = extract(aggregate);
        if (rawValue !== null && Number.isFinite(rawValue) && rawValue > 0) {
            candidates.push({ opId: operation.id, rowIndex, rawValue });
        }
    });
    return candidates;
};

const collectL1FullnessCandidates = (
    operations: readonly OperationsLike[],
    l1PressureByOpId: Map<number, L1PressureMetrics>,
): RankedCandidate[] => {
    const candidates: RankedCandidate[] = [];
    operations.forEach((operation, rowIndex) => {
        const metrics = l1PressureByOpId.get(operation.id);
        if (metrics && Number.isFinite(metrics.fullnessPercent) && metrics.fullnessPercent > 0) {
            candidates.push({ opId: operation.id, rowIndex, rawValue: metrics.fullnessPercent });
        }
    });
    return candidates;
};

/**
 * Compute the ranked annotation map for the requested mode. Returns an empty
 * map when the required source data is missing — consumers should still call
 * this unconditionally and let the empty map turn into "render no annotations"
 * naturally, rather than branching at the call site.
 *
 * `perfAggregatesByOpId` should already be the result of `aggregatePerfByOp`
 * over the *matched* perf rows (see `useGetDeviceOperationListPerf`), not the
 * raw perf report — otherwise the op-id space is wrong on multi-device runs.
 */
export const selectTopNAnnotations = ({
    mode,
    n,
    operations,
    perfAggregatesByOpId,
    l1PressureByOpId,
}: SelectTopNParams): Map<number, RankedAnnotation> => {
    const annotationsByOpId = new Map<number, RankedAnnotation>();
    if (n <= 0 || operations.length === 0) {
        return annotationsByOpId;
    }

    let candidates: RankedCandidate[];
    let formatValueLabel: (rawValue: number) => string;
    let normalise: (rawValue: number, minValue: number, maxValue: number) => number;

    if (mode === TopNAnnotationMode.L1_FULLNESS) {
        if (!l1PressureByOpId || l1PressureByOpId.size === 0) {
            return annotationsByOpId;
        }
        candidates = collectL1FullnessCandidates(operations, l1PressureByOpId);
        formatValueLabel = formatPercentLabel;
        normalise = normaliseLinear;
    } else {
        if (!perfAggregatesByOpId || perfAggregatesByOpId.size === 0) {
            return annotationsByOpId;
        }
        const spec = PERF_MODE_SPEC[mode];
        candidates = collectPerfCandidates(operations, perfAggregatesByOpId, spec.extract);
        formatValueLabel = spec.formatValueLabel;
        normalise = spec.normalise;
    }

    const topN = pickTopN(candidates, n);
    if (topN.length === 0) {
        return annotationsByOpId;
    }

    let minValue = Infinity;
    let maxValue = -Infinity;
    for (const candidate of topN) {
        if (candidate.rawValue < minValue) {
            minValue = candidate.rawValue;
        }
        if (candidate.rawValue > maxValue) {
            maxValue = candidate.rawValue;
        }
    }

    topN.forEach((candidate, index) => {
        annotationsByOpId.set(candidate.opId, {
            opId: candidate.opId,
            rowIndex: candidate.rowIndex,
            rank: index + 1,
            t: normalise(candidate.rawValue, minValue, maxValue),
            valueLabel: formatValueLabel(candidate.rawValue),
            rawValue: candidate.rawValue,
        });
    });

    return annotationsByOpId;
};

/**
 * User-facing mode label, kept next to the enum so the controls UI doesn't
 * have to hand-maintain a parallel mapping. Used in both the dropdown label
 * and the per-row tooltip ("#3 slowest by …").
 */
export const TOP_N_MODE_LABEL: Record<TopNAnnotationMode, string> = {
    [TopNAnnotationMode.PERF_TIME]: 'kernel duration',
    [TopNAnnotationMode.PERF_OP_TO_OP_GAP]: 'op-to-op gap',
    [TopNAnnotationMode.PERF_DRAM_PERCENT]: 'DRAM utilization',
    [TopNAnnotationMode.PERF_FLOPS_PERCENT]: 'FLOPS utilization',
    [TopNAnnotationMode.L1_FULLNESS]: 'L1 fullness',
};
