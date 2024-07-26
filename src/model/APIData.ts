// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

export interface TensorData {
    tensor_id: number;
    shape: string;
    dtype: string;
    layout: string;
    memory_config: string | null;
    device_id: number | null;
    address: number | null;
    buffer_type: number | null;
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

export interface OperationDetailsData {
    operation_id: number;
    input_tensors: TensorData[];
    output_tensors: TensorData[];
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
