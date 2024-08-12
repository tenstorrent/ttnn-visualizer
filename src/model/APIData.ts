// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { BufferType } from './BufferType';
import { Operation, Tensor } from './Graph';

export interface TensorData extends Tensor {
    shape: string;
    dtype: string;
    layout: string;
    memory_config: string | null;
    device_id: number | null;
    address: number | null;
    buffer_type: BufferType | null;
    io: 'input' | 'output' | null;
    producerNames: string[]; // TODO: this is a very brittle way to connect producer ids to operation names
    consumerNames: string[];
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
}

export const defaultOperationDetailsData: OperationDetailsData = {
    id: 0,
    name: '',
    inputs: [],
    outputs: [],
    buffers: [],
    l1_sizes: [],
    stack_trace: '',
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

export interface MicroOperationInputTensor {
    dtype: number;
    layout: number;
    memory_config: {
        buffer_type: number;
        memory_layout: number;
        shard_spec: number | null;
    };
    shape: {
        dimensions: number[];
        padding: {
            pad_dimensions: {
                back: number;
                front: number;
            }[];
            pad_value: number;
            rank: number;
        };
        rank: number;
    };
    storage_type: number;
}

export interface MicroOperation {
    input_tensor_records: MicroOperationInputTensor[];
    operation_name: string;
    operation_type: string;
    program_cache_hit: boolean | null;
    program_hash: number | null;
    ttnn_operation_id: number; // TODO: we should lose ttnn prefix unless it has meaning. even then it should be a property
}

export interface OperationDescription extends Operation {
    duration: number;
    arguments: { name: string; value: string }[];
    microOperations: MicroOperation[];
}
