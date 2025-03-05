// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { IconName } from '@blueprintjs/core';

export interface PerfTableRow {
    id: string;
    advice: string[]; // New
    op?: number; // New
    ORIGINAL_ID?: number; // New
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
    output_0_memory: string; // New
    input_0_datatype: string;
    input_1_datatype: string;
    dram_sharded: string;
    input_0_memory: string;
    input_1_memory: string; // New
    inner_dim_block_size: string;
    output_subblock_h: string;
    output_subblock_w: string;
    high_dispatch?: boolean; // New
}

export interface Cell {
    raw_value: string | number | null | undefined | boolean;
    icon?: IconName;
    iconColor?: string;
    tooltip?: string;
    unit?: string;
    decimals?: number;
    color?: string;
}

export interface RowData {
    ID: number;
    'DEVICE ID'?: number;
    'HOST START TS'?: number;
    'DEVICE FW DURATION [ns]'?: number;
    'DEVICE KERNEL DURATION [ns]'?: string;
    'OP CODE'?: string;
    'OP TO OP LATENCY [ns]'?: number;
    'CORE COUNT'?: string;
    INPUT_0_W?: number;
    INPUT_0_X?: number;
    INPUT_0_Y?: number;
    INPUT_0_Z?: number;
    INPUT_0_MEMORY?: string;
    INPUT_0_DATATYPE?: string;
    INPUT_1_W?: number;
    INPUT_1_X?: number;
    INPUT_1_Y?: number;
    INPUT_1_Z?: number;
    INPUT_1_MEMORY?: string;
    INPUT_1_DATATYPE?: string;
    OUTPUT_0_W?: number;
    OUTPUT_0_X?: number;
    OUTPUT_0_Y?: number;
    OUTPUT_0_Z?: number;
    OUTPUT_0_MEMORY?: string;
    OUTPUT_0_DATATYPE?: string;
    'MATH FIDELITY'?: string;
    ATTRIBUTES?: string;
    'OP TYPE'?: string;
    'PM IDEAL [ns]'?: string;

    ORIGINAL_ID?: number;
}

export interface ProcessedRow {
    [key: string]: Cell;
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
