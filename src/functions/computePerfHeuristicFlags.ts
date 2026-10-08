// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { BoundAnalysis, BoundType } from '../definitions/PerfTable';
import { TypedPerfTableRow } from '../model/PerfTable';
import { PERF_HEURISTIC_THRESHOLDS, PerfHeuristicFlag } from '../definitions/PerfHeuristics';
import { OpType } from '../definitions/Performance';
import getCoreUtilization from './getCoreUtilization';
import isValidNumber from './isValidNumber';
import { formatPercentage } from './math';
import { isSlowDramDominant } from './perfBoundPredicates';
import { getAllocationFailureSummary } from './parseAllocationFailure';
import { getDramFallbackSummary } from './detectDramFallbacks';

interface RowHeuristicEvaluation {
    flags: PerfHeuristicFlag[];
    details: Partial<Record<PerfHeuristicFlag, string>> | undefined;
}

// The ideal time behind utilisation is tt-metal's op perf model, which is most trustworthy for the
// ops tt-perf-report also models; say so on the ops it does not. tt-perf-report decides that by
// op-code name, so the note must not claim the op is not a convolution (Conv3d falls outside it).
export const LOW_UTILISATION_UNMODELLED_NOTE =
    'tt-perf-report has no roofline model for this op, so the ideal time this compares against is less reliable.';

const { LOW_CORE_UTILISATION_RATIO, UNDERUTILISED_CORES_RATIO, MIN_TOTAL_PERCENT } = PERF_HEURISTIC_THRESHOLDS;

function meetsMinImpact(row: TypedPerfTableRow): boolean {
    return row.total_percent != null && row.total_percent >= MIN_TOTAL_PERCENT;
}

function isEligibleRow(row: TypedPerfTableRow): boolean {
    if (row.missing) {
        return false;
    }

    if (row.op_type === OpType.SIGNPOST) {
        return false;
    }

    if (row.bound === BoundType.HOST) {
        return false;
    }

    return true;
}

function isDramBound(row: TypedPerfTableRow, hasMinImpact: boolean): boolean {
    if (!hasMinImpact) {
        return false;
    }

    if (row.bound === BoundType.DRAM) {
        return true;
    }

    return isSlowDramDominant(row);
}

function getDramBoundDetail(row: TypedPerfTableRow): string | null {
    if (isSlowDramDominant(row)) {
        return `DRAM ${formatPercentage(row.dram_percent!)} vs FLOPS ${formatPercentage(row.flops_percent!)}`;
    }

    return row.bound != null ? `Bound: ${row.bound}` : null;
}

function isUnderutilisedCores(row: TypedPerfTableRow, maxCores: number, hasMinImpact: boolean): boolean {
    if (!hasMinImpact) {
        return false;
    }

    const { cores } = row;

    if (!isValidNumber(cores) || maxCores <= 0) {
        return false;
    }

    const availableCoreCount = row.available_cores ?? maxCores;
    return availableCoreCount > 0 && cores / availableCoreCount < UNDERUTILISED_CORES_RATIO;
}

function evaluateRowHeuristics(row: TypedPerfTableRow, maxCores: number): RowHeuristicEvaluation {
    const flags: PerfHeuristicFlag[] = [];
    const details: Partial<Record<PerfHeuristicFlag, string>> = {};

    // A recorded failure, not a heuristic: no eligibility or impact gate may mute it.
    if (row.allocation_failure) {
        flags.push(PerfHeuristicFlag.ALLOCATION_FAILURE);
        details[PerfHeuristicFlag.ALLOCATION_FAILURE] = getAllocationFailureSummary(row.allocation_failure);
    }

    if (!isEligibleRow(row)) {
        return { flags, details: flags.length > 0 ? details : undefined };
    }

    // Inferred, so eligibility applies; impact does not, because the cost lands on the later
    // ops that read this output from DRAM rather than on this row.
    if (row.dram_fallback) {
        flags.push(PerfHeuristicFlag.DRAM_FALLBACK);
        details[PerfHeuristicFlag.DRAM_FALLBACK] = getDramFallbackSummary(row.dram_fallback);
    }

    const hasMinImpact = meetsMinImpact(row);

    if (isDramBound(row, hasMinImpact)) {
        flags.push(PerfHeuristicFlag.DRAM_BOUND);
        const detail = getDramBoundDetail(row);

        if (detail != null) {
            details[PerfHeuristicFlag.DRAM_BOUND] = detail;
        }
    }

    if (hasMinImpact && isValidNumber(row.pm_ideal_ns) && isValidNumber(row.device_time) && isValidNumber(row.cores)) {
        const utilisation = getCoreUtilization(row, maxCores);

        if (utilisation > 0 && utilisation < LOW_CORE_UTILISATION_RATIO) {
            flags.push(PerfHeuristicFlag.LOW_UTILISATION);
            const utilisationDetail = `Core utilisation: ${formatPercentage(utilisation * 100)}`;

            details[PerfHeuristicFlag.LOW_UTILISATION] =
                row.bound_analysis === BoundAnalysis.NONE
                    ? `${utilisationDetail}. ${LOW_UTILISATION_UNMODELLED_NOTE}`
                    : utilisationDetail;
        }
    }

    if (isUnderutilisedCores(row, maxCores, hasMinImpact)) {
        flags.push(PerfHeuristicFlag.UNDERUTILISED_CORES);

        if (row.cores != null) {
            details[PerfHeuristicFlag.UNDERUTILISED_CORES] = `Cores: ${row.cores} / ${row.available_cores ?? maxCores}`;
        }
    }

    if (row.hash != null && !row.isFirstHashOccurrence && row.cache_hit === false) {
        flags.push(PerfHeuristicFlag.RECOMPUTE_CANDIDATE);
        details[PerfHeuristicFlag.RECOMPUTE_CANDIDATE] = `Hash: ${row.hash}`;
    }

    return {
        flags,
        details: flags.length > 0 ? details : undefined,
    };
}

export function annotatePerfHeuristicFlags(rows: TypedPerfTableRow[], maxCores: number): TypedPerfTableRow[] {
    return rows.map((row) => {
        const { flags, details } = evaluateRowHeuristics(row, maxCores);

        return {
            ...row,
            heuristicFlags: flags,
            heuristicFlagDetails: details,
        };
    });
}
