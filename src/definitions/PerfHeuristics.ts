// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export enum PerfHeuristicFlag {
    DRAM_BOUND = 'dram_bound',
    LOW_UTILISATION = 'low_utilisation',
    UNDERUTILISED_CORES = 'underutilised_cores',
    RECOMPUTE_CANDIDATE = 'recompute_candidate',
    ALLOCATION_FAILURE = 'allocation_failure',
    DRAM_FALLBACK = 'dram_fallback',
}

export enum PerfHeuristicFlagIntent {
    WARNING = 'warning',
    DANGER = 'danger',
}

export enum PerfHeuristicFlagSource {
    PERF_REPORT = 'perf_report',
    MEMORY_REPORT_RECORDED = 'memory_report_recorded',
    MEMORY_REPORT_INFERRED = 'memory_report_inferred',
}

export const PERF_HEURISTIC_FLAG_SOURCE_LABELS: Record<PerfHeuristicFlagSource, string> = {
    [PerfHeuristicFlagSource.PERF_REPORT]: 'Heuristic over the performance report.',
    [PerfHeuristicFlagSource.MEMORY_REPORT_RECORDED]: 'Recorded in the linked memory report.',
    [PerfHeuristicFlagSource.MEMORY_REPORT_INFERRED]: 'Inferred from the linked memory report, not recorded in it.',
};

export interface PerfHeuristicFlagDefinition {
    label: string;
    shortLabel: string;
    description: string;
    intent: PerfHeuristicFlagIntent;
    source: PerfHeuristicFlagSource;
}

// Matches tt-perf-report's mute threshold in perfFunctions cell colouring — keep in sync.
export const MIN_TOTAL_PERCENT = 0.5;

// Mirrored in `backend/ttnn_visualizer/agent/perf_flags.py`, as is `MIN_TOTAL_PERCENT`.
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
        source: PerfHeuristicFlagSource.PERF_REPORT,
    },
    [PerfHeuristicFlag.LOW_UTILISATION]: {
        label: 'Low utilisation',
        shortLabel: 'Low util',
        description: 'Core utilisation is below ideal for the assigned core count.',
        intent: PerfHeuristicFlagIntent.WARNING,
        source: PerfHeuristicFlagSource.PERF_REPORT,
    },
    [PerfHeuristicFlag.UNDERUTILISED_CORES]: {
        label: 'Underutilised cores',
        shortLabel: 'Few cores',
        description: 'This op uses a small fraction of available device cores.',
        intent: PerfHeuristicFlagIntent.WARNING,
        source: PerfHeuristicFlagSource.PERF_REPORT,
    },
    [PerfHeuristicFlag.RECOMPUTE_CANDIDATE]: {
        label: 'Recompute candidate',
        shortLabel: 'Recompute',
        description: 'An identical op hash was recomputed instead of reusing a cached result.',
        intent: PerfHeuristicFlagIntent.DANGER,
        source: PerfHeuristicFlagSource.PERF_REPORT,
    },
    [PerfHeuristicFlag.ALLOCATION_FAILURE]: {
        label: 'Operation failed to allocate',
        shortLabel: 'Op failed',
        description: 'This device op ran, but a later device op of the same operation failed to allocate memory.',
        intent: PerfHeuristicFlagIntent.DANGER,
        source: PerfHeuristicFlagSource.MEMORY_REPORT_RECORDED,
    },
    [PerfHeuristicFlag.DRAM_FALLBACK]: {
        label: 'Likely DRAM fallback',
        shortLabel: 'DRAM fallback?',
        description:
            "L1 was requested or had just failed to allocate, but this op's output is in DRAM. tt-metal does not record fallbacks, so treat this as a lead to check, not a fact.",
        intent: PerfHeuristicFlagIntent.WARNING,
        source: PerfHeuristicFlagSource.MEMORY_REPORT_INFERRED,
    },
};
