// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export interface ColumnDefinition {
    name: string;
    key: ColumnKeys;
    colour?: string;
    unit?: string;
    decimals?: number;
    sortable?: boolean;
    filterable?: boolean;
    footerSpan?: number;
}

export enum BoundType {
    BOTH = 'BOTH',
    DRAM = 'DRAM',
    FLOP = 'FLOP',
    SLOW = 'SLOW',
    HOST = 'HOST',
}

export const MarkerColours = [
    'rgb(0, 128, 128)',
    'rgb(255, 215, 0)',
    'rgb(31, 119, 180)',
    'rgb(255, 69, 0)',
    'rgb(44, 160, 44)',
    'rgb(227, 119, 194)',
    'rgb(75, 0, 130)',
    'rgb(255, 127, 14)',
    'rgb(154, 205, 50)',
    'rgb(0, 191, 255)',
    'rgb(214, 39, 40)',
    'rgb(255, 105, 180)',
    'rgb(188, 189, 34)',
    'rgb(148, 103, 189)',
    'rgb(40, 108, 26)',
    'rgb(255, 187, 120)',
    'rgb(196, 156, 148)',
    'rgb(23, 190, 207)',
    'rgb(199, 199, 199)',
    'rgb(128, 0, 128)',
    'rgb(219, 219, 141)',
    'rgb(82, 84, 163)',
    'rgb(255, 152, 150)',
    'rgb(156, 158, 222)',
    'rgb(107, 110, 207)',
    'rgb(247, 182, 210)',
    'rgb(158, 218, 229)',
    'rgb(197, 176, 213)',
    'rgb(140, 86, 75)',
    'rgb(255, 127, 14)',
    'rgb(57, 59, 121)',
];

export interface Marker {
    opCode: string;
    colour: (typeof MarkerColours)[number];
}

export enum ColumnKeys {
    Id = 'id',
    TotalPercent = 'total_percent',
    Bound = 'bound',
    OpCode = 'op_code',
    Flags = 'heuristicFlags',
    Device = 'device',
    BufferType = 'buffer_type',
    DeviceTime = 'device_time',
    Layout = 'layout',
    OpToOpGap = 'op_to_op_gap',
    Cores = 'cores',
    Dram = 'dram',
    DramPercent = 'dram_percent',
    Flops = 'flops',
    FlopsPercent = 'flops_percent',
    MathFidelity = 'math_fidelity',
    OP = 'op',
    HighDispatch = 'high_dispatch',
    GlobalCallCount = 'global_call_count',
    Hash = 'hash',
    CacheHit = 'cache_hit',
    L1Fullness = 'l1_fullness_percent',
    DeviceKernelDuration = 'device_kernel_duration',
    BriscKernelDuration = 'brisc_kernel_duration',
    NcriscKernelDuration = 'ncrisc_kernel_duration',
    Trisc0KernelDuration = 'trisc0_kernel_duration',
    Trisc1KernelDuration = 'trisc1_kernel_duration',
    Trisc2KernelDuration = 'trisc2_kernel_duration',
    EriscKernelDuration = 'erisc_kernel_duration',
}

export const Columns: ColumnDefinition[] = [
    { name: 'ID', key: ColumnKeys.Id, sortable: true },
    { name: 'Total %', key: ColumnKeys.TotalPercent, unit: '%', decimals: 1, sortable: true },
    { name: 'Bound', key: ColumnKeys.Bound, colour: 'yellow' },
    {
        name: 'OP Code',
        key: ColumnKeys.OpCode,
        colour: 'blue',
        sortable: true,
        filterable: true,
        // Absorbs Flags + Device + Type (all footerSpan: 0) — keep in sync with getFooterColumns.
        footerSpan: 4,
    },
    { name: 'Flags', key: ColumnKeys.Flags, footerSpan: 0 },
    { name: 'Device', key: ColumnKeys.Device, footerSpan: 0 },
    { name: 'Type', key: ColumnKeys.BufferType, sortable: true, filterable: true, footerSpan: 0 },
    { name: 'Layout', key: ColumnKeys.Layout, sortable: true, filterable: true },
    { name: 'Device Time', key: ColumnKeys.DeviceTime, unit: 'µs', decimals: 0, sortable: true },
    { name: 'Op-to-Op Gap', key: ColumnKeys.OpToOpGap, colour: 'red', unit: 'µs', decimals: 0, sortable: true },
    { name: 'Cores', key: ColumnKeys.Cores, colour: 'green', sortable: true },
    { name: 'DRAM', key: ColumnKeys.Dram, colour: 'yellow', unit: 'GB/s', decimals: 1, sortable: true },
    { name: 'DRAM %', key: ColumnKeys.DramPercent, colour: 'yellow', unit: '%', decimals: 1, sortable: true },
    { name: 'FLOPS', key: ColumnKeys.Flops, unit: 'TFLOPS', decimals: 1, sortable: true },
    { name: 'FLOPS %', key: ColumnKeys.FlopsPercent, unit: '%', decimals: 1, sortable: true },
    { name: 'Math Fidelity', key: ColumnKeys.MathFidelity, colour: 'cyan' },
    // Per-RISC kernel durations (#1518). Stored in µs (converted from the raw ns CSV values in
    // enrichRowData); 2dp keeps sub-microsecond contributions legible alongside Device Time.
    { name: 'Kernel Duration', key: ColumnKeys.DeviceKernelDuration, unit: 'µs', decimals: 2, sortable: true },
    { name: 'BRISC', key: ColumnKeys.BriscKernelDuration, unit: 'µs', decimals: 2, sortable: true },
    { name: 'NCRISC', key: ColumnKeys.NcriscKernelDuration, unit: 'µs', decimals: 2, sortable: true },
    { name: 'TRISC_0', key: ColumnKeys.Trisc0KernelDuration, unit: 'µs', decimals: 2, sortable: true },
    { name: 'TRISC_1', key: ColumnKeys.Trisc1KernelDuration, unit: 'µs', decimals: 2, sortable: true },
    { name: 'TRISC_2', key: ColumnKeys.Trisc2KernelDuration, unit: 'µs', decimals: 2, sortable: true },
    { name: 'ERISC', key: ColumnKeys.EriscKernelDuration, unit: 'µs', decimals: 2, sortable: true },
    { name: 'Hash', key: ColumnKeys.Hash },
    { name: 'Cache Hit', key: ColumnKeys.CacheHit, colour: 'magenta', filterable: true },
];

export const L1PressureColumns: ColumnDefinition[] = [
    { name: 'L1 Usage %', key: ColumnKeys.L1Fullness, unit: '%', decimals: 1, sortable: true },
];

export const LOCKED_PERF_COLUMN_KEYS: ColumnKeys[] = [ColumnKeys.Id, ColumnKeys.OpCode];

export const DISPLAY_COLUMNS_LABEL = 'Display columns';

// L1 pressure is computed from the active profiler report's buffers (op-id sync and buffer
// lookups are both keyed to that report), so it cannot be attributed per comparison report.
// ColumnKeys.L1Fullness is intentionally excluded here — comparison sub-rows render an empty
// L1 cell rather than the active report's numbers misattributed to another report.
export const comparisonKeys: ColumnKeys[] = [
    ColumnKeys.Bound,
    ColumnKeys.BufferType,
    ColumnKeys.Cores,
    ColumnKeys.Device,
    ColumnKeys.DeviceTime,
    ColumnKeys.Dram,
    ColumnKeys.DramPercent,
    ColumnKeys.Flops,
    ColumnKeys.FlopsPercent,
    ColumnKeys.GlobalCallCount,
    ColumnKeys.HighDispatch,
    ColumnKeys.Layout,
    ColumnKeys.MathFidelity,
    ColumnKeys.OpCode,
    ColumnKeys.Flags,
    ColumnKeys.OpToOpGap,
    ColumnKeys.TotalPercent,
    ColumnKeys.DeviceKernelDuration,
    ColumnKeys.BriscKernelDuration,
    ColumnKeys.NcriscKernelDuration,
    ColumnKeys.Trisc0KernelDuration,
    ColumnKeys.Trisc1KernelDuration,
    ColumnKeys.Trisc2KernelDuration,
    ColumnKeys.EriscKernelDuration,
    ColumnKeys.Hash,
    ColumnKeys.CacheHit,
];

export type PerfTableFilters = Partial<Record<ColumnKeys, string>> | null;
