// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { BoundType, TypedPerfTableRow } from '../definitions/PerfTable';
import { PERF_HEURISTIC_THRESHOLDS, PerfHeuristicFlag } from '../definitions/PerfHeuristics';
import { OpType } from '../definitions/Performance';
import getCoreUtilization from './getCoreUtilization';
import isValidNumber from './isValidNumber';
import { formatPercentage } from './math';
import { isSlowDramDominant } from './perfBoundPredicates';

interface RowHeuristicEvaluation {
    flags: PerfHeuristicFlag[];
    details: Partial<Record<PerfHeuristicFlag, string>> | undefined;
}

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

    return cores / maxCores < UNDERUTILISED_CORES_RATIO;
}

function evaluateRowHeuristics(row: TypedPerfTableRow, maxCores: number): RowHeuristicEvaluation {
    if (!isEligibleRow(row)) {
        return { flags: [], details: undefined };
    }

    const hasMinImpact = meetsMinImpact(row);
    const flags: PerfHeuristicFlag[] = [];
    const details: Partial<Record<PerfHeuristicFlag, string>> = {};

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
            details[PerfHeuristicFlag.LOW_UTILISATION] = `Core utilisation: ${formatPercentage(utilisation * 100)}`;
        }
    }

    if (isUnderutilisedCores(row, maxCores, hasMinImpact)) {
        flags.push(PerfHeuristicFlag.UNDERUTILISED_CORES);

        if (row.cores != null) {
            details[PerfHeuristicFlag.UNDERUTILISED_CORES] = `Cores: ${row.cores} / ${maxCores}`;
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
