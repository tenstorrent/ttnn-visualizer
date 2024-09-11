// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Operation, Tensor } from './Graph';

export interface TensorData extends Tensor {
    shape: string;
    dtype: string;
    layout: string;
    memory_config: string | null;
    device_id: number | null;
    io: 'input' | 'output' | null; // TODO: validate usefulness in the future
}

export interface BufferData {
    operation_id: number;
    device_id: number;
    address: number;
    max_size_per_bank: number;
    buffer_type: number;
}

export interface OperationDetailsData extends Operation {
    id: number;
    inputs: TensorData[];
    outputs: TensorData[];
    buffers: BufferData[];
    l1_sizes: number[];
    stack_trace: string;
    device_operations: Node[];
}

// TODO: we may want to revisit the 'default' portion for the variable name
export const defaultOperationDetailsData: OperationDetailsData = {
    id: 0,
    name: '',
    inputs: [],
    outputs: [],
    buffers: [],
    l1_sizes: [],
    stack_trace: '',
    device_operations: [],
};

export interface Chunk {
    address: number;
    size: number;
}

export interface FragmentationEntry extends Chunk {
    empty?: boolean;
}

export interface ReportMetaData {
    cache_path: string;
    model_cache_path: string;
    tmp_dir: string;
    enable_model_cache: boolean;
    enable_fast_runtime_mode: boolean;
    throw_exception_on_fallback: boolean;
    enable_logging: boolean;
    enable_graph_report: boolean;
    enable_detailed_buffer_report: boolean;
    enable_detailed_tensor_report: boolean;
    enable_comparison_mode: boolean;
    comparison_mode_pcc: number;
    root_report_path: string;
    report_name: string;
}

export interface OperationDescription extends Operation {
    duration: number;
    arguments: { name: string; value: string }[];
    device_operations: Node[];
}

export enum NodeType {
    capture_start = 'capture_start',
    capture_end = 'capture_end',
    function_start = 'function_start',
    function_end = 'function_end',
    buffer = 'buffer',
    buffer_allocate = 'buffer_allocate',
    buffer_deallocate = 'buffer_deallocate',
    circular_buffer_allocate = 'circular_buffer_allocate',
    circular_buffer_deallocate_all = 'circular_buffer_deallocate_all',
    tensor = 'tensor',
}

enum DeviceOperationLayoutTypes {
    INTERLEAVED,
    SINGLE_BANK,
}

enum DeviceOperationTypes {
    L1,
    DRAM,
}

interface DeviceOperationParams {
    inputs: number;
    name: string;
    tensor_id: number;
    shape: string;
    address: string;
    layout: DeviceOperationLayoutTypes;
    size: string;
    type: DeviceOperationTypes;
    core_range_set: string;
}

export interface Node {
    connections: number[];
    id: number;
    node_type: NodeType;
    params: DeviceOperationParams;
}

export interface DeviceOperation {
    name: string;
    cbList: CircularBuffer[];
    deallocateAll: boolean;
    indentLevel: number; // device ops nesting level indicator
}

export interface CircularBuffer extends Chunk {
    core_range_set: string;
}
