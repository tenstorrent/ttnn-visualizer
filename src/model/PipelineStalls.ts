// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { CbWaitZone, PipelineThread, PipelineThreadRole, StallSource, StallState } from '../definitions/PipelineStalls';

// Shares of the cycles each core's counters ran: the average, min and max across the op's cores.
export interface StallStat {
    avg: number;
    min: number | null;
    max: number | null;
}

export interface NamedStallStat extends StallStat {
    label: string;
}

export interface NamedWait extends NamedStallStat {
    // As `LargestWait`'s: a wait on an earlier stage.
    downstream: boolean;
}

export interface ThreadHardwareCounters {
    issue_rate: StallStat | null;
    stall_rate: StallStat | null;
    // tt-llk's ratio, not a share: the thread's waits summed over its cycles, which can pass 1.
    stall_overlap: StallStat | null;
    // Above 0 on some core, by average.
    waits: NamedWait[];
    zero_waits: string[];
    // Math's alone: shares of the cycles a math instruction was ready.
    math_pipeline_stalls?: NamedStallStat[];
}

// tt-metal sums a CB poll over the op's cores; the per-core figure divides it by the op's core count.
export interface CbWait {
    sum_us: number;
    per_core_us: number | null;
    kernel_share_percent: number | null;
}

export interface ThreadStalls {
    thread: PipelineThread;
    role: PipelineThreadRole;
    hardware_counters: ThreadHardwareCounters | null;
    instrumentation: Partial<Record<CbWaitZone, CbWait>> | null;
}

export interface LargestWait {
    label: string;
    source: StallSource;
    percent: number;
    // A wait on an earlier stage, such as the packer waiting for math: a symptom, not the thread's cause.
    downstream: boolean;
}

// Whether the capture filled one part of the stalls, with what fills it where it did not.
export interface StallPart {
    state: StallState;
    fill_hint: string | null;
}

/** `stalls` in `GET /api/performance/counters/<perf_id>`. */
export interface OperationStalls {
    has_compute_kernel: boolean | null;
    counters: StallPart;
    cb_waits: StallPart;
    // Null where the CSV's is not a positive whole number, and so are the per-core figures.
    core_count: number | null;
    kernel_duration_us: number | null;
    // The largest of the threads' stall rates and CB poll shares, never their sum.
    stalled_percent: number | null;
    // That share as an average core's time: an estimate.
    stalled_us: number | null;
    stalled_thread: PipelineThread | null;
    largest_wait: LargestWait | null;
    threads: ThreadStalls[];
}
