// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { BufferType } from "./BufferType";

import { Operation, Tensor } from "./Graph";


export interface TensorData extends Tensor{

    shape: string;
    dtype: string;
    layout: string;
    memory_config: string | null;
    device_id: number | null;
    address: number | null;
    buffer_type: BufferType | null;
    io: 'input' | 'output' | null;
    producerNames: string[];
    consumerNames: string[];
    producers: number[];
    consumers: number[];
}

export interface BufferData {
    operation_id: number;
    device_id: number;
    address: number;
    max_size_per_bank: number;
    buffer_type: number;
}

export interface OperationDetailsData extends Operation{
    operation_id: number;
    inputs: TensorData[];
    outputs: TensorData[];
    buffers: BufferData[];
    l1_sizes: number[];
    stack_trace: string;
}

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
