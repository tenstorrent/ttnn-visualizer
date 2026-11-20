// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
    CbWaitZone,
    PipelineThread,
    PipelineThreadRole,
    StallSource,
    StallState,
} from '../../src/definitions/PipelineStalls';
import {
    CbWait,
    NamedStallStat,
    OperationStalls,
    StallPart,
    StallStat,
    ThreadHardwareCounters,
    ThreadStalls,
} from '../../src/model/PipelineStalls';

// Shaped as `/api/performance/counters/<perf_id>` answers `stalls` for a Blackhole capture with fpu, pack, unpack
// and instrn and sum profiling, in round figures of the size such a capture holds.

export const stat = (avg: number): StallStat => ({ avg, min: avg * 0.9, max: avg * 1.1 });

// What the server says fills each part, as `pipeline_stalls` words it.
export const COUNTERS_FILL_HINT =
    'filled when the capture ran with --profiler-capture-perf-counters=instrn,unpack,pack,fpu';
export const CB_WAITS_FILL_HINT = 'filled when the capture ran with --enable-sum-profiling';

const part = (state: StallState, fillHint: string | null = null): StallPart => ({ state, fill_hint: fillHint });

export const named = (label: string, avg: number): NamedStallStat => ({ label, ...stat(avg) });

const counters = (
    issue: number,
    stall: number,
    waits: NamedStallStat[],
    zeroWaits: string[],
    mathPipelineStalls?: NamedStallStat[],
): ThreadHardwareCounters => ({
    issue_rate: stat(issue),
    stall_rate: stat(stall),
    stall_overlap: stat(0.5),
    waits,
    zero_waits: zeroWaits,
    ...(mathPipelineStalls ? { math_pipeline_stalls: mathPipelineStalls } : {}),
});

const getKernelShare = (sumUs: number, cores: number, kernelUs: number): number => (sumUs / cores / kernelUs) * 100;

const cbWait = (sumUs: number, cores: number, kernelUs: number): CbWait => ({
    sum_us: sumUs,
    per_core_us: sumUs / cores,
    kernel_share_percent: getKernelShare(sumUs, cores, kernelUs),
});

const thread = (
    threadId: PipelineThread,
    role: PipelineThreadRole,
    hardwareCounters: ThreadHardwareCounters | null,
    instrumentation: ThreadStalls['instrumentation'] = null,
): ThreadStalls => ({ thread: threadId, role, hardware_counters: hardwareCounters, instrumentation });

const MATMUL_CORES = 88;
const MATMUL_KERNEL_US = 26;

export const T0_ZERO_WAITS = [
    'Unpack Waiting on Pack (T0)',
    'MOVE Idle Wait T0',
    'Semaphore Zero Wait T0',
    'Semaphore Full Wait T0',
    'SrcA Clear Wait',
    'SrcB Clear Wait',
];

const INPUT_WAIT_SUM_US = 1742.4;
export const INPUT_WAIT_SHARE = getKernelShare(INPUT_WAIT_SUM_US, MATMUL_CORES, MATMUL_KERNEL_US);
const INPUT_WAIT = cbWait(INPUT_WAIT_SUM_US, MATMUL_CORES, MATMUL_KERNEL_US);
const OUTPUT_WAIT = cbWait(330, MATMUL_CORES, MATMUL_KERNEL_US);

// Starved of input, as a matmul reading DRAM is: three quarters of the kernel in cb_wait_front.
export const INPUT_STARVED_STALLS: OperationStalls = {
    has_compute_kernel: true,
    counters: part(StallState.FILLED),
    cb_waits: part(StallState.FILLED),
    core_count: MATMUL_CORES,
    kernel_duration_us: MATMUL_KERNEL_US,
    stalled_percent: INPUT_WAIT_SHARE,
    stalled_us: INPUT_WAIT.per_core_us,
    stalled_thread: PipelineThread.T0,
    largest_wait: {
        label: CbWaitZone.WAIT_FRONT,
        source: StallSource.INSTRUMENTATION,
        percent: INPUT_WAIT_SHARE,
        downstream: false,
    },
    threads: [
        thread(
            PipelineThread.T0,
            PipelineThreadRole.UNPACK,
            counters(
                3.1,
                2,
                [named('THCON Idle Wait T0', 1.5), named('Unpack Idle Wait T0', 0.5), named('CFG Idle Wait T0', 0.1)],
                T0_ZERO_WAITS,
            ),
            { [CbWaitZone.WAIT_FRONT]: INPUT_WAIT },
        ),
        thread(
            PipelineThread.T1,
            PipelineThreadRole.MATH,
            counters(
                10.8,
                0.6,
                [
                    named('Math Idle Wait T1', 0.6),
                    named('SFPU Idle Wait T1', 0.6),
                    named('Semaphore Full Wait T1', 0.1),
                ],
                ['Math Waiting on Unpack (T1)', 'Semaphore Zero Wait T1', 'SrcA Valid Wait', 'SrcB Valid Wait'],
                [
                    { label: 'Data Hazard Stall Rate', avg: 0, min: 0, max: 0 },
                    { label: 'Math Scoreboard Stall Rate', avg: 0, min: 0, max: 0 },
                ],
            ),
        ),
        thread(
            PipelineThread.T2,
            PipelineThreadRole.PACK,
            counters(
                8.1,
                11.2,
                [named('Semaphore Zero Wait T2', 76.4), named('Pack Idle Wait T2', 1.9)],
                ['Pack Waiting on Math (T2)', 'Semaphore Full Wait T2'],
            ),
            { [CbWaitZone.RESERVE_BACK]: OUTPUT_WAIT },
        ),
    ],
};

const withThread = (stalls: OperationStalls, threadId: PipelineThread, update: Partial<ThreadStalls>) => ({
    ...stalls,
    threads: stalls.threads.map((entry) => (entry.thread === threadId ? { ...entry, ...update } : entry)),
});

// Its math pipeline stalls on the scoreboard, which the math thread's rows show beside its waits.
export const SCOREBOARD_STALLS: OperationStalls = withThread(INPUT_STARVED_STALLS, PipelineThread.T1, {
    hardware_counters: counters(
        33.7,
        3.9,
        [named('Semaphore Full Wait T1', 3.4)],
        [],
        [named('Math Scoreboard Stall Rate', 33.2), { label: 'Data Hazard Stall Rate', avg: 0, min: 0, max: 0 }],
    ),
});

// Bound by its unpacker: the stall rate is the largest figure, and the thread's top named wait explains it.
export const UNPACK_BOUND_STALLS: OperationStalls = {
    ...INPUT_STARVED_STALLS,
    stalled_percent: 27.7,
    largest_wait: {
        label: 'Unpack Idle Wait T0',
        source: StallSource.HARDWARE_COUNTER,
        percent: 27.8,
        downstream: false,
    },
};

// A stall no named wait explains.
export const UNNAMED_STALL_STALLS: OperationStalls = {
    ...INPUT_STARVED_STALLS,
    stalled_percent: 40,
    stalled_thread: PipelineThread.T1,
    largest_wait: null,
};

const UNCOUNTED_THREADS = INPUT_STARVED_STALLS.threads.map((entry) => ({ ...entry, hardware_counters: null }));

// A concat: no compute kernel, and the previous op's CB sums on its row again.
export const NO_COMPUTE_KERNEL_STALLS: OperationStalls = {
    ...INPUT_STARVED_STALLS,
    has_compute_kernel: false,
    counters: part(StallState.NO_VALUE),
    cb_waits: part(StallState.IGNORED),
    stalled_percent: null,
    stalled_us: null,
    stalled_thread: null,
    largest_wait: null,
    threads: UNCOUNTED_THREADS.map((entry) => ({ ...entry, instrumentation: null })),
};

// A capture of counters without the instrn group, such as fpu alone, and without sum profiling.
export const NOT_CAPTURED_STALLS: OperationStalls = {
    ...NO_COMPUTE_KERNEL_STALLS,
    has_compute_kernel: true,
    counters: part(StallState.NOT_CAPTURED, COUNTERS_FILL_HINT),
    cb_waits: part(StallState.NOT_CAPTURED, CB_WAITS_FILL_HINT),
};

// A counter capture without sum profiling: the packer's wait on math is the largest, a symptom.
export const NO_SUM_PROFILING_STALLS: OperationStalls = {
    ...INPUT_STARVED_STALLS,
    cb_waits: part(StallState.NOT_CAPTURED, CB_WAITS_FILL_HINT),
    stalled_percent: 11.2,
    stalled_us: 2.184,
    stalled_thread: PipelineThread.T2,
    largest_wait: {
        label: 'Semaphore Zero Wait T2',
        source: StallSource.HARDWARE_COUNTER,
        percent: 76.4,
        downstream: true,
    },
    threads: INPUT_STARVED_STALLS.threads.map((entry) => ({ ...entry, instrumentation: null })),
};

// A compute op whose counters were never recorded, its CB waits still timed.
export const UNRECORDED_STALLS: OperationStalls = {
    ...INPUT_STARVED_STALLS,
    counters: part(StallState.NO_VALUE),
    threads: INPUT_STARVED_STALLS.threads.map((entry) => ({ ...entry, hardware_counters: null })),
};

// A compute op without CB sums in a capture whose other ops have them.
export const NO_CB_VALUE_STALLS: OperationStalls = {
    ...NO_SUM_PROFILING_STALLS,
    cb_waits: part(StallState.NO_VALUE),
};

const withoutShares = (wait: CbWait): CbWait => ({ ...wait, per_core_us: null, kernel_share_percent: null });

// A row whose core count the server could not read: its CB sums stand alone, and the packer's stall is the largest.
export const NO_CORE_COUNT_STALLS: OperationStalls = {
    ...NO_SUM_PROFILING_STALLS,
    cb_waits: part(StallState.FILLED),
    core_count: null,
    threads: [
        { ...INPUT_STARVED_STALLS.threads[0], instrumentation: { [CbWaitZone.WAIT_FRONT]: withoutShares(INPUT_WAIT) } },
        INPUT_STARVED_STALLS.threads[1],
        {
            ...INPUT_STARVED_STALLS.threads[2],
            instrumentation: { [CbWaitZone.RESERVE_BACK]: withoutShares(OUTPUT_WAIT) },
        },
    ],
};
