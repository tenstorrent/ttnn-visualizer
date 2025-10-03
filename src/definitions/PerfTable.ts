// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { OpType } from './Performance';

export type TableKeys = keyof PerfTableRow;
export type TableFilter = Partial<Record<TableKeys, string>> | null;

export interface TableHeader {
    label: string;
    key: TableKeys;
    colour?: string;
    unit?: string;
    decimals?: number;
    sortable?: boolean;
    filterable?: boolean;
}

enum BoundType {
    BOTH,
    DRAM,
    FLOP,
    SLOW,
    HOST,
}

export interface PerfTableRow {
    id: string;
    global_call_count: number;
    advice: string[];
    total_percent: string;
    bound: BoundType;
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
    op_type: OpType;
    op?: number;
    missing?: boolean;
}

export interface TypedPerfTableRow
    extends Omit<
        PerfTableRow,
        | 'id'
        | 'global_call_count'
        | 'total_percent'
        | 'device_time'
        | 'op_to_op_gap'
        | 'cores'
        | 'dram'
        | 'dram_percent'
        | 'flops'
        | 'flops_percent'
        | 'bound'
    > {
    id: number | null;
    global_call_count: number | null;
    total_percent: number | null;
    device_time: number | null;
    op_to_op_gap: number | null;
    cores: number | null;
    dram: number | null;
    dram_percent: number | null;
    flops: number | null;
    flops_percent: number | null;
    bound: BoundType | null;
}

export enum MathFidelity {
    HiFi4 = 'HiFi4',
    HiFi2 = 'HiFi2',
    LoFi = 'LoFi',
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

export enum ColumnHeaders {
    id = 'id',
    total_percent = 'total_percent',
    bound = 'bound',
    op_code = 'op_code',
    device_time = 'device_time',
    op_to_op_gap = 'op_to_op_gap',
    cores = 'cores',
    dram = 'dram',
    dram_percent = 'dram_percent',
    flops = 'flops',
    flops_percent = 'flops_percent',
    math_fidelity = 'math_fidelity',
    OP = 'op',
    high_dispatch = 'high_dispatch',
    global_call_count = 'global_call_count',
}

export const TableHeaders: TableHeader[] = [
    { label: 'ID', key: ColumnHeaders.id, sortable: true },
    { label: 'Total %', key: ColumnHeaders.total_percent, unit: '%', decimals: 1, sortable: true },
    { label: 'Bound', key: ColumnHeaders.bound, colour: 'yellow' },
    { label: 'OP Code', key: ColumnHeaders.op_code, colour: 'blue', sortable: true, filterable: true },
    { label: 'Device Time', key: ColumnHeaders.device_time, unit: 'µs', decimals: 0, sortable: true },
    { label: 'Op-to-Op Gap', key: ColumnHeaders.op_to_op_gap, colour: 'red', unit: 'µs', decimals: 0, sortable: true },
    { label: 'Cores', key: ColumnHeaders.cores, colour: 'green', sortable: true },
    { label: 'DRAM', key: ColumnHeaders.dram, colour: 'yellow', unit: 'GB/s', sortable: true },
    { label: 'DRAM %', key: ColumnHeaders.dram_percent, colour: 'yellow', unit: '%', sortable: true },
    { label: 'FLOPs', key: ColumnHeaders.flops, unit: 'TFLOPs', sortable: true },
    { label: 'FLOPs %', key: ColumnHeaders.flops_percent, unit: '%', sortable: true },
    { label: 'Math Fidelity', key: ColumnHeaders.math_fidelity, colour: 'cyan' },
];

export const FilterableColumnKeys = TableHeaders.filter((column) => column.filterable).map((column) => column.key);

export const ComparisonKeys: TableKeys[] = [
    ColumnHeaders.op_code,
    ColumnHeaders.bound,
    ColumnHeaders.total_percent,
    ColumnHeaders.device_time,
    ColumnHeaders.op_to_op_gap,
    ColumnHeaders.cores,
    ColumnHeaders.dram,
    ColumnHeaders.dram_percent,
    ColumnHeaders.flops,
    ColumnHeaders.flops_percent,
    ColumnHeaders.math_fidelity,
    ColumnHeaders.high_dispatch,
    ColumnHeaders.global_call_count,
];

export const signpostRowDefaults = Object.freeze({
    global_call_count: null,
    total_percent: null,
    device_time: null,
    op_to_op_gap: null,
    cores: null,
    dram: null,
    dram_percent: null,
    flops: null,
    flops_percent: null,
    advice: [],
    bound: null,
    math_fidelity: '',
    output_datatype: '',
    output_0_memory: '',
    input_0_datatype: '',
    input_1_datatype: '',
    dram_sharded: '',
    input_0_memory: '',
    input_1_memory: '',
    inner_dim_block_size: '',
    output_subblock_h: '',
    output_subblock_w: '',
    pm_ideal_ns: '',
    op_type: OpType.SIGNPOST,
});
