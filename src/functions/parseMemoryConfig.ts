// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

export interface ShardSpec {
    grid?: string;
    shape?: [number, number];
    orientation?: string;
    halo?: number;
}

export type MemoryKeys = 'shard_spec' | 'memory_layout' | 'grid' | 'shape' | 'orientation' | 'halo';

const memoryConfigPattern = /MemoryConfig\((.*)\)$/;
const memoryLayoutPattern = /memory_layout=([A-Za-z_:]+)/;
const shardSpecPattern =
    /shard_spec=ShardSpec\(grid=\{(\[.*?\])\},shape=\{(\d+),\s*(\d+)\},orientation=ShardOrientation::([A-Z_]+),halo=(\d+)\)/;

const parseMemoryConfig = (string: string) => {
    const match = string.match(memoryConfigPattern);

    if (match) {
        const capturedString = match[1];

        const memoryLayoutMatch = capturedString.match(memoryLayoutPattern);
        const shardSpecMatch = capturedString.match(shardSpecPattern);

        const memoryLayout = memoryLayoutMatch ? memoryLayoutMatch[1] : null;
        const shardSpec = shardSpecMatch
            ? {
                  grid: shardSpecMatch[1],
                  shape: [parseInt(shardSpecMatch[2], 10), parseInt(shardSpecMatch[3], 10)],
                  orientation: shardSpecMatch[4],
                  halo: parseInt(shardSpecMatch[5], 10),
              }
            : null;

        return {
            memory_layout: memoryLayout,
            shard_spec: shardSpec || 'std::nullopt',
        };
    }

    return string;
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
