// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { BoundType } from '../definitions/PerfTable';
import { PerfHeuristicFlag } from '../definitions/PerfHeuristics';
import { OpType } from '../definitions/Performance';
import { DeviceOperationLayoutTypes } from './APIData';
import { BufferType as BufferTypeEnum } from './BufferType';

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
    // Nullable: the backend reads these from the ops perf CSV with dict.get(), so they are absent
    // when the source CSV lacks the column (older Tracy captures).
    device_kernel_duration: string | null;
    brisc_kernel_duration: string | null;
    ncrisc_kernel_duration: string | null;
    trisc0_kernel_duration: string | null;
    trisc1_kernel_duration: string | null;
    trisc2_kernel_duration: string | null;
    erisc_kernel_duration: string | null;
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
    | 'device_kernel_duration'
    | 'brisc_kernel_duration'
    | 'ncrisc_kernel_duration'
    | 'trisc0_kernel_duration'
    | 'trisc1_kernel_duration'
    | 'trisc2_kernel_duration'
    | 'erisc_kernel_duration'
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
    device_kernel_duration: number | null;
    brisc_kernel_duration: number | null;
    ncrisc_kernel_duration: number | null;
    trisc0_kernel_duration: number | null;
    trisc1_kernel_duration: number | null;
    trisc2_kernel_duration: number | null;
    erisc_kernel_duration: number | null;
    // Next two extracted from input_0_memory
    buffer_type: BufferTypeEnum | null;
    layout: DeviceOperationLayoutTypes | null;
    isFirstHashOccurrence: boolean;
    l1_fullness_percent: number | null;
    l1_free_segments: number | null;
    l1_largest_free: number | null;
    l1_largest_free_percent: number | null;
    heuristicFlags?: PerfHeuristicFlag[];
    heuristicFlagDetails?: Partial<Record<PerfHeuristicFlag, string>>;
}

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
    device_kernel_duration: null,
    brisc_kernel_duration: null,
    ncrisc_kernel_duration: null,
    trisc0_kernel_duration: null,
    trisc1_kernel_duration: null,
    trisc2_kernel_duration: null,
    erisc_kernel_duration: null,
    op_type: OpType.SIGNPOST,
    device: null,
    layout: null,
    buffer_type: null,
    hash: null,
    cache_hit: null,
    isFirstHashOccurrence: true,
    l1_fullness_percent: null,
    l1_free_segments: null,
    l1_largest_free: null,
    l1_largest_free_percent: null,
});
