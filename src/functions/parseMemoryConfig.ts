// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

export interface ShardSpec {
    grid?: string;
    shape?: [number, number];
    orientation?: string;
    halo?: number;
}

export interface MemoryConfig {
    memory_layout: TensorMemoryLayout;
    shard_spec: ShardSpec | string;
}

export enum TensorMemoryLayout {
    'INTERLEAVED' = 'TensorMemoryLayout::INTERLEAVED',
    'HEIGHT_SHARDED' = 'TensorMemoryLayout::HEIGHT_SHARDED',
    'BLOCK_SHARDED' = 'TensorMemoryLayout::BLOCK_SHARDED',
}

export type MemoryKeys = 'shard_spec' | 'memory_layout' | 'grid' | 'shape' | 'orientation' | 'halo';

const memoryConfigPattern = /MemoryConfig\((.*)\)$/;
const memoryLayoutPattern = /memory_layout=([A-Za-z_:]+)/;
const shardSpecPattern =
    /shard_spec=ShardSpec\(grid=\{(\[.*?\])\},shape=\{(\d+),\s*(\d+)\},orientation=ShardOrientation::([A-Z_]+),halo=(\d+)\)/;

const parseMemoryConfig = (string: string): MemoryConfig | null => {
    const match = string.match(memoryConfigPattern);

    if (match) {
        const capturedString = match[1];

        const memoryLayoutMatch = capturedString.match(memoryLayoutPattern);
        const shardSpecMatch = capturedString.match(shardSpecPattern);

        const memoryLayout = memoryLayoutMatch ? memoryLayoutMatch[1] : '';
        const shardSpec: ShardSpec | string = shardSpecMatch
            ? {
                  grid: shardSpecMatch[1],
                  shape: [parseInt(shardSpecMatch[2], 10), parseInt(shardSpecMatch[3], 10)],
                  orientation: shardSpecMatch[4],
                  halo: parseInt(shardSpecMatch[5], 10),
              }
            : 'std::nullopt';

        return {
            memory_layout: memoryLayout as TensorMemoryLayout,
            shard_spec: shardSpec,
        };
    }

    return null;
};

export const MEMORY_CONFIG_HEADERS = {
    shard_spec: 'ShardSpec',
    memory_layout: 'MemoryLayout',
    grid: 'CoreRangeSet',
    shape: 'Shape',
    orientation: 'ShardOrientation',
    halo: 'Halo',
};

export function getMemoryConfigHeader(key: MemoryKeys) {
    return MEMORY_CONFIG_HEADERS[key];
}

export default parseMemoryConfig;
