// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export type TableKeys = Partial<keyof PerfTableRow>;

export type TableFilter = Record<TableKeys, string> | null;

export interface TableHeader {
    label: string;
    key: TableKeys;
    colour?: string;
    unit?: string;
    decimals?: number;
    sortable?: boolean;
    filterable?: boolean;
}

export interface PerfTableRow {
    id: string;
    global_call_count: number;
    advice: string[];
    total_percent: string;
    bound: string;
    op_code: string;
    raw_op_code: string;
    device_time: string;
    op_to_op_gap: string;
    cores: string;
    dram: string;
    dram_percent: string;
    flops: string;
    flops_percent: string;
    math_fidelity: string;
    output_datatype: string;
    output_0_memory: string;
    input_0_datatype: string;
    input_1_datatype: string;
    dram_sharded: string;
    input_0_memory: string;
    input_1_memory: string;
    inner_dim_block_size: string;
    output_subblock_h: string;
    output_subblock_w: string;
    high_dispatch?: boolean;
    pm_ideal_ns: string;
    op?: number;
    missing?: boolean;
}

export type MathFidelity = 'HiFi4' | 'HiFi2' | 'LoFi';

export const MARKER_COLOURS = [
    'rgb(31, 119, 180)',
    'rgb(255, 127, 14)',
    'rgb(44, 160, 44)',
    'rgb(214, 39, 40)',
    'rgb(148, 103, 189)',
    'rgb(140, 86, 75)',
    'rgb(227, 119, 194)',
    'rgb(188, 189, 34)',
    'rgb(23, 190, 207)',
    'rgb(255, 187, 120)',
    'rgb(40, 108, 26)',
    'rgb(255, 152, 150)',
    'rgb(197, 176, 213)',
    'rgb(196, 156, 148)',
    'rgb(247, 182, 210)',
    'rgb(199, 199, 199)',
    'rgb(219, 219, 141)',
    'rgb(158, 218, 229)',
    'rgb(57, 59, 121)',
    'rgb(82, 84, 163)',
    'rgb(107, 110, 207)',
    'rgb(156, 158, 222)',
    'rgb(255, 127, 14)',
];

export interface Marker {
    opCode: string;
    colour: (typeof MARKER_COLOURS)[number];
}
