// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

export interface Operation {
    id: number;
    name: string;
    inputs: Tensor[];
    outputs: Tensor[];
}

export interface OperationDescription extends Operation {
    duration: number;
    arguments: { name: string; value: string }[];
    microOperations: MicroOperation[];
}

export interface Tensor {
    id: number;
    producers: number[];
    consumers: number[];
}

export interface MicroOperation {
    input_tensor_records: MicroOperationInputTensor[];
    operation_name: string;
    operation_type: string;
    program_cache_hit: boolean | null;
    program_hash: number | null;
    ttnn_operation_id: number; // TODO: we should lose ttnn prefix unless it has meaning. even then it should be a property
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
