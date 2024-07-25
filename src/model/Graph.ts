export interface Operation {
    id: number;
    name: string;
    arguments: { name: string; value: string }[];
    microOperations: MicroOperation[];
}

export interface MicroOperation {
    input_tensor_records: InputTensor[];
    operation_name: string;
    operation_type: string;
    program_cache_hit: boolean | null;
    program_hash: number | null;
    ttnn_operation_id: number;
}

export interface InputTensor {
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
