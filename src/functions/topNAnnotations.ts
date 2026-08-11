// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { OpPerfAggregate } from './perfOverlay';
import { formatDuration } from './formatting';
import {
    RankedAnnotation,
    SelectTopNParams,
    TOP_N_COUNT_MAX,
    TopNAnnotationMode,
} from '../definitions/TopNAnnotations';
import { L1PressureMetrics } from '../model/L1Pressure';

/**
 * Discriminator for which data pipeline a mode belongs to. Perf modes pull
 * from `perfAggregatesByOpId`; the L1 mode pulls from `l1PressureByOpId`.
 * Kept exported so `useTopNAnnotations` can dispatch without restating the
 * enum check.
 */
export const isPerfMode = (mode: TopNAnnotationMode): boolean => mode !== TopNAnnotationMode.L1_FULLNESS;

interface OperationsLike {
    id: number;
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

    // The count is persisted per user, so a value stored before the rail gained
    // a capacity can still arrive here asking for more dots than can be drawn
    // without them covering each other.
    const topN = pickTopN(candidates, Math.min(n, TOP_N_COUNT_MAX));
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
