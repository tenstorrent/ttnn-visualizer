// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { DeviceOperationLayoutTypes } from '../model/APIData';
import { BufferType as BufferTypeEnum } from '../model/BufferType';
import { OpType } from './Performance';

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

export interface PerfTableRow {
    id: string;
    global_call_count: number;
    advice: string[];
    total_percent: string;
    bound: BoundType;
    op_code: string;
    raw_op_code: string;
    device: string;
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
    hash: string | null;
    cache_hit: boolean | null;
}

export interface TypedPerfTableRow extends Omit<
    PerfTableRow,
    | 'id'
    | 'global_call_count'
    | 'total_percent'
    | 'device'
    | 'device_time'
    | 'op_to_op_gap'
    | 'cores'
    | 'dram'
    | 'dram_percent'
    | 'flops'
    | 'flops_percent'
    | 'bound'
    | 'pm_ideal_ns'
> {
    id: number | null;
    global_call_count: number | null;
    total_percent: number | null;
    device: number | null;
    device_time: number | null;
    op_to_op_gap: number | null;
    cores: number | null;
    dram: number | null;
    dram_percent: number | null;
    flops: number | null;
    flops_percent: number | null;
    bound: BoundType | null;
    pm_ideal_ns: number | null;
    // Next two extracted from input_0_memory
    buffer_type: BufferTypeEnum | null;
    layout: DeviceOperationLayoutTypes | null;
    isFirstHashOccurrence: boolean;
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
        footerSpan: 3,
    },
    { name: 'Device ID', key: ColumnKeys.Device, footerSpan: 0 },
    { name: 'Buffer Type', key: ColumnKeys.BufferType, sortable: true, filterable: true, footerSpan: 0 },
    { name: 'Layout', key: ColumnKeys.Layout, sortable: true, filterable: true },
    { name: 'Device Time', key: ColumnKeys.DeviceTime, unit: 'µs', decimals: 0, sortable: true },
    { name: 'Op-to-Op Gap', key: ColumnKeys.OpToOpGap, colour: 'red', unit: 'µs', decimals: 0, sortable: true },
    { name: 'Cores', key: ColumnKeys.Cores, colour: 'green', sortable: true },
    { name: 'DRAM', key: ColumnKeys.Dram, colour: 'yellow', unit: 'GB/s', decimals: 1, sortable: true },
    { name: 'DRAM %', key: ColumnKeys.DramPercent, colour: 'yellow', unit: '%', decimals: 1, sortable: true },
    { name: 'FLOPS', key: ColumnKeys.Flops, unit: 'TFLOPS', decimals: 1, sortable: true },
    { name: 'FLOPS %', key: ColumnKeys.FlopsPercent, unit: '%', decimals: 1, sortable: true },
    { name: 'Math Fidelity', key: ColumnKeys.MathFidelity, colour: 'cyan' },
    { name: 'Cache Hit', key: ColumnKeys.CacheHit, colour: 'magenta', filterable: true },
];

export const comparisonKeys: ColumnKeys[] = [
    ColumnKeys.OpCode,
    ColumnKeys.Bound,
    ColumnKeys.TotalPercent,
    ColumnKeys.DeviceTime,
    ColumnKeys.OpToOpGap,
    ColumnKeys.Cores,
    ColumnKeys.Dram,
    ColumnKeys.DramPercent,
    ColumnKeys.Flops,
    ColumnKeys.FlopsPercent,
    ColumnKeys.MathFidelity,
    ColumnKeys.HighDispatch,
    ColumnKeys.GlobalCallCount,
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
    pm_ideal_ns: null,
    op_type: OpType.SIGNPOST,
    device: null,
    layout: null,
    buffer_type: null,
    hash: null,
    cache_hit: null,
    isFirstHashOccurrence: true,
});

export type PerfTableFilters = Partial<Record<ColumnKeys, string>> | null;
