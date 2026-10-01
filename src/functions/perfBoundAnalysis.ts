// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { BoundAnalysis, ColumnKeys } from '../definitions/PerfTable';
import { OpType } from '../definitions/Performance';
import { TypedPerfTableRow } from '../model/PerfTable';

export const NOT_ANALYSED_LABEL = 'n/a';

export const NOT_MODELLED_REASON =
    'Not analysed: tt-perf-report only models DRAM and FLOPs for matmuls, and FLOPs for convolutions. ' +
    'It does not mean this op is not a bottleneck.';

export const FLOPS_ONLY_REASON =
    'Not analysed: convolutions only get a FLOPs model, so DRAM and Bound are never derived.';

export const MISSING_INPUTS_REASON =
    'Not measured: the trace lacks inputs the roofline model needs for this op, so no figure could be derived.';

const ROOFLINE_KEYS: ReadonlySet<ColumnKeys> = new Set([
    ColumnKeys.Bound,
    ColumnKeys.Dram,
    ColumnKeys.DramPercent,
    ColumnKeys.Flops,
    ColumnKeys.FlopsPercent,
]);

// A convolution's FLOPs figures are modelled; everything that depends on DRAM is not.
const FLOPS_ONLY_UNMODELLED_KEYS: ReadonlySet<ColumnKeys> = new Set([
    ColumnKeys.Bound,
    ColumnKeys.Dram,
    ColumnKeys.DramPercent,
]);

/**
 * Why a roofline cell (Bound, DRAM, DRAM %, FLOPS, FLOPS %) is empty, or null when it is not
 * empty for a reason the reader needs telling. Callers only ask for cells whose value is missing.
 *
 * Rows without `bound_analysis` (tt-perf-report < 1.4.0, placeholders) return null: without the
 * column there is no way to tell the cases apart, so they keep rendering blank.
 */
export const getNotAnalysedReason = (row: TypedPerfTableRow, key: ColumnKeys): string | null => {
    if (!ROOFLINE_KEYS.has(key) || row.op_type === OpType.SIGNPOST) {
        return null;
    }

    switch (row.bound_analysis) {
        case BoundAnalysis.NONE:
            return NOT_MODELLED_REASON;
        case BoundAnalysis.FLOPS_ONLY:
            return FLOPS_ONLY_UNMODELLED_KEYS.has(key) ? FLOPS_ONLY_REASON : MISSING_INPUTS_REASON;
        case BoundAnalysis.FULL:
            return MISSING_INPUTS_REASON;
        default:
            return null;
    }
};

export interface BoundAnalysisCoverage {
    /** Share of device time in ops given any roofline model (full + FLOPs only). */
    analysedPercent: number;
    fullPercent: number;
    flopsOnlyPercent: number;
}

/**
 * Share of device time that tt-perf-report's roofline models cover across `rows`. Returns null
 * when no row reports `bound_analysis` or there is no device time to share out, so callers show
 * nothing rather than a misleading 0%.
 */
export const getBoundAnalysisCoverage = (rows: TypedPerfTableRow[]): BoundAnalysisCoverage | null => {
    let totalTime = 0;
    let fullTime = 0;
    let flopsOnlyTime = 0;

    for (const row of rows) {
        const deviceTime = row.device_time;
        // Host ops carry no device time, and signposts and placeholders carry neither field.
        const isCounted =
            row.bound_analysis !== null && deviceTime !== null && Number.isFinite(deviceTime) && deviceTime > 0;

        if (isCounted) {
            totalTime += deviceTime;

            if (row.bound_analysis === BoundAnalysis.FULL) {
                fullTime += deviceTime;
            } else if (row.bound_analysis === BoundAnalysis.FLOPS_ONLY) {
                flopsOnlyTime += deviceTime;
            }
        }
    }

    if (totalTime === 0) {
        return null;
    }

    const fullPercent = (fullTime / totalTime) * 100;
    const flopsOnlyPercent = (flopsOnlyTime / totalTime) * 100;

    return { analysedPercent: fullPercent + flopsOnlyPercent, fullPercent, flopsOnlyPercent };
};
