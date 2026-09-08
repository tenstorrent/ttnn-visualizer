// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export interface ShardSpec {
    grid?: string;
    shape?: [number, number];
    orientation?: string;
    halo?: number;
    mode?: string;
    physical_shard_shape?: string;
}

export interface MemoryConfig {
    memory_layout: TensorMemoryLayout;
    shard_spec: ShardSpec | string;
}

export enum TensorMemoryLayout {
    'INTERLEAVED' = 'TensorMemoryLayout::INTERLEAVED',
    'HEIGHT_SHARDED' = 'TensorMemoryLayout::HEIGHT_SHARDED',
    'BLOCK_SHARDED' = 'TensorMemoryLayout::BLOCK_SHARDED',
    'WIDTH_SHARDED' = 'TensorMemoryLayout::WIDTH_SHARDED',
}

export enum BufferMemoryLayout {
    INTERLEAVED = 0,
    HEIGHT_SHARDED = 2,
    WIDTH_SHARDED = 3,
    BLOCK_SHARDED = 4,
}

export type MemoryKeys =
    | 'shard_spec'
    | 'memory_layout'
    | 'grid'
    | 'shape'
    | 'orientation'
    | 'halo'
    | 'mode'
    | 'physical_shard_shape';
