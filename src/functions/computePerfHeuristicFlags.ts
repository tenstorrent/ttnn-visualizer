// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { BoundType, TypedPerfTableRow } from '../definitions/PerfTable';
import {
    PERF_HEURISTIC_FLAG_DEFINITIONS,
    PERF_HEURISTIC_THRESHOLDS,
    PerfHeuristicFlag,
} from '../definitions/PerfHeuristics';
import { OpType } from '../definitions/Performance';
import getCoreUtilization from './getCoreUtilization';
import isValidNumber from './isValidNumber';
import { formatPercentage } from './math';

export interface PerfHeuristicContext {
    maxCores: number;
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

function isDramBound(row: TypedPerfTableRow): boolean {
    if (!meetsMinImpact(row)) {
        return false;
    }

    if (row.bound === BoundType.DRAM) {
        return true;
    }

    if (row.bound === BoundType.SLOW && row.dram_percent != null && row.flops_percent != null) {
        return row.dram_percent > row.flops_percent;
    }

    return false;
}

function isLowUtilisation(row: TypedPerfTableRow, maxCores: number): boolean {
    if (!meetsMinImpact(row)) {
        return false;
    }

    const { pm_ideal_ns: idealNs, device_time: deviceTime, cores } = row;

    if (!isValidNumber(idealNs) || !isValidNumber(deviceTime) || !isValidNumber(cores)) {
        return false;
    }

    const utilisation = getCoreUtilization(row, maxCores);

    return utilisation > 0 && utilisation < LOW_CORE_UTILISATION_RATIO;
}

function isUnderutilisedCores(row: TypedPerfTableRow, maxCores: number): boolean {
    if (!meetsMinImpact(row)) {
        return false;
    }

    const { cores } = row;

    if (!isValidNumber(cores) || maxCores <= 0) {
        return false;
    }

    return cores / maxCores < UNDERUTILISED_CORES_RATIO;
}

function isRecomputeCandidate(row: TypedPerfTableRow): boolean {
    if (!isEligibleRow(row)) {
        return false;
    }

    return row.hash != null && !row.isFirstHashOccurrence && row.cache_hit === false;
}

export function computePerfHeuristicFlags(row: TypedPerfTableRow, context: PerfHeuristicContext): PerfHeuristicFlag[] {
    if (!isEligibleRow(row)) {
        return [];
    }

    const flags: PerfHeuristicFlag[] = [];

    if (isDramBound(row)) {
        flags.push(PerfHeuristicFlag.DRAM_BOUND);
    }

    if (isLowUtilisation(row, context.maxCores)) {
        flags.push(PerfHeuristicFlag.LOW_UTILISATION);
    }

    if (isUnderutilisedCores(row, context.maxCores)) {
        flags.push(PerfHeuristicFlag.UNDERUTILISED_CORES);
    }

    if (isRecomputeCandidate(row)) {
        flags.push(PerfHeuristicFlag.RECOMPUTE_CANDIDATE);
    }

    return flags;
}

export function annotatePerfHeuristicFlags(
    rows: TypedPerfTableRow[],
    context: PerfHeuristicContext,
): TypedPerfTableRow[] {
    return rows.map((row) => ({
        ...row,
        heuristicFlags: computePerfHeuristicFlags(row, context),
    }));
}

export function getPerfHeuristicFlagTooltipDetail(
    flag: PerfHeuristicFlag,
    row: TypedPerfTableRow,
    context: PerfHeuristicContext,
): string | null {
    switch (flag) {
        case PerfHeuristicFlag.DRAM_BOUND:
            if (row.bound === BoundType.SLOW && row.dram_percent != null && row.flops_percent != null) {
                return `DRAM ${formatPercentage(row.dram_percent)} vs FLOPS ${formatPercentage(row.flops_percent)}`;
            }

            return row.bound != null ? `Bound: ${row.bound}` : null;
        case PerfHeuristicFlag.LOW_UTILISATION: {
            const utilisation = getCoreUtilization(row, context.maxCores);

            return isValidNumber(row.pm_ideal_ns) ? `Core utilisation: ${formatPercentage(utilisation * 100)}` : null;
        }
        case PerfHeuristicFlag.UNDERUTILISED_CORES:
            return row.cores != null ? `Cores: ${row.cores} / ${context.maxCores}` : null;
        case PerfHeuristicFlag.RECOMPUTE_CANDIDATE:
            return row.hash != null ? `Hash: ${row.hash}` : null;
        default:
            return null;
    }
}

export function getPerfHeuristicFlagDefinition(flag: PerfHeuristicFlag) {
    return PERF_HEURISTIC_FLAG_DEFINITIONS[flag];
}
