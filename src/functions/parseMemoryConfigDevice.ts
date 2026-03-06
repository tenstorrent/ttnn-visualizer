// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

interface Coord {
    x: number;
    y: number;
}

interface GridRange {
    start: Coord;
    end: Coord;
}

interface NdShardSpec {
    shard_shape: number[];
    grid: GridRange[];
    orientation: string;
    shard_distribution_strategy: string;
}

interface ShardSpec {
    grid: GridRange[];
    shape: number[];
    orientation: string;
}

interface MemoryConfig {
    memory_layout: string;
    buffer_type: string;
    shard_spec?: ShardSpec;
    nd_shard_spec?: NdShardSpec;
    created_with_nd_shard_spec?: number;
}

export function parseMemoryConfigDevice(input: string): MemoryConfig {
    const get = (re: RegExp) => input.match(re)?.[1];

    const parseGrid = (text?: string): GridRange[] => {
        if (!text) {
            return [];
        }
        const matches = [...text.matchAll(/start":{"x":(\d+),"y":(\d+)},"end":{"x":(\d+),"y":(\d+)}/g)];
        return matches.map((m) => ({
            start: { x: Number(m[1]), y: Number(m[2]) },
            end: { x: Number(m[3]), y: Number(m[4]) },
        }));
    };

    const parseNums = (text?: string): number[] => (text ? text.split(',').map((n) => Number(n.trim())) : []);

    const memoryLayout = get(/memory_layout=([^,]+)/);
    const bufferType = get(/buffer_type=([^,]+)/);

    const shardGridText = get(/shard_spec=.*?grid=\[(.*?)\]/);
    const shardShapeText = get(/shape=\[(.*?)\]/);
    const shardOrientation = get(/orientation=(ShardOrientation::\w+)/);

    const ndShardShape = get(/"shard_shape":\[(.*?)\]/);
    const ndGridText = get(/"grid":\[(.*?)\]/);
    const ndOrientation = get(/"orientation":"([^"]+)"/);
    const ndStrategy = get(/"shard_distribution_strategy":"([^"]+)"/);

    const created = get(/created_with_nd_shard_spec=(\d+)/);

    const config: MemoryConfig = {
        memory_layout: memoryLayout ?? '',
        buffer_type: bufferType ?? '',
    };

    if (shardGridText || shardShapeText) {
        config.shard_spec = {
            grid: parseGrid(shardGridText),
            shape: parseNums(shardShapeText),
            orientation: shardOrientation ?? '',
        };
    }

    if (ndShardShape || ndGridText) {
        config.nd_shard_spec = {
            shard_shape: parseNums(ndShardShape),
            grid: parseGrid(ndGridText),
            orientation: ndOrientation ?? '',
            shard_distribution_strategy: ndStrategy ?? '',
        };
    }

    if (created) {
        config.created_with_nd_shard_spec = Number(created);
    }

    return config;
}
