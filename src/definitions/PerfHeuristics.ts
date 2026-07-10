// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export enum PerfHeuristicFlag {
    DRAM_BOUND = 'dram_bound',
    LOW_UTILISATION = 'low_utilisation',
    UNDERUTILISED_CORES = 'underutilised_cores',
    RECOMPUTE_CANDIDATE = 'recompute_candidate',
}

export enum PerfHeuristicFlagIntent {
    WARNING = 'warning',
    DANGER = 'danger',
}

export interface PerfHeuristicContext {
    maxCores: number;
}

export interface PerfHeuristicFlagDefinition {
    label: string;
    shortLabel: string;
    description: string;
    intent: PerfHeuristicFlagIntent;
}

// Matches tt-perf-report's mute threshold in perfFunctions cell colouring — keep in sync.
export const MIN_TOTAL_PERCENT = 0.5;

export const PERF_HEURISTIC_THRESHOLDS = {
    LOW_CORE_UTILISATION_RATIO: 0.3,
    UNDERUTILISED_CORES_RATIO: 0.25,
    MIN_TOTAL_PERCENT,
} as const;

export const PERF_HEURISTIC_FLAG_DEFINITIONS: Record<PerfHeuristicFlag, PerfHeuristicFlagDefinition> = {
    [PerfHeuristicFlag.DRAM_BOUND]: {
        label: 'DRAM bound',
        shortLabel: 'DRAM bound',
        description: 'DRAM bandwidth is the likely bottleneck for this op.',
        intent: PerfHeuristicFlagIntent.WARNING,
    },
    [PerfHeuristicFlag.LOW_UTILISATION]: {
        label: 'Low utilisation',
        shortLabel: 'Low util',
        description:
            'Core utilisation is below ideal for the assigned core count. Most reliable for matmul and conv ops.',
        intent: PerfHeuristicFlagIntent.WARNING,
    },
    [PerfHeuristicFlag.UNDERUTILISED_CORES]: {
        label: 'Underutilised cores',
        shortLabel: 'Few cores',
        description: 'This op uses a small fraction of available device cores.',
        intent: PerfHeuristicFlagIntent.WARNING,
    },
    [PerfHeuristicFlag.RECOMPUTE_CANDIDATE]: {
        label: 'Recompute candidate',
        shortLabel: 'Recompute',
        description: 'An identical op hash was recomputed instead of reusing a cached result.',
        intent: PerfHeuristicFlagIntent.DANGER,
    },
};
