// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { MemoryConfig, MemoryKeys, ShardSpec, TensorMemoryLayout } from '../model/MemoryConfig';
import { BufferType, StringBufferType, StringBufferTypeToBufferType } from '../model/BufferType';

// Unanchored at the start, so it also matches a value that only ends in a memory config. Kept
// as it is for the details view; anchoring it would change which arguments that view parses.
const trailingMemoryConfigPattern = /MemoryConfig\((.*)\)$/;
// Anchored at both ends, like the backend's `re.match`, so a tensor argument whose repr merely
// ends in a memory config is not read as a request. Older reports namespace the type.
const wholeMemoryConfigPattern = /^(?:tt::tt_metal::)?MemoryConfig\((.*)\)$/;
const bufferTypePattern = /buffer_type=BufferType::([A-Z0-9_]+)/;
const memoryLayoutPattern = /memory_layout=([A-Za-z_:]+)/;
const shardSpecPattern =
    /shard_spec=ShardSpec\((?:grid=\{(\[.*?\])\},?)?(?:shape=\{(\d+), (\d+)\},?)?(?:orientation=ShardOrientation::([A-Za-z_]+),?)?(?:halo=(\d+),?)?(?:mode=ShardMode::([A-Z_]+),?)?(?:physical_shard_shape=std::([A-Za-z_]+),?)?/;

const parseMemoryConfig = (string: string): MemoryConfig | null => {
    const match = string.match(trailingMemoryConfigPattern);

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
                  mode: shardSpecMatch[6],
                  physical_shard_shape: shardSpecMatch[7],
              }
            : 'std::nullopt';

        return {
            memory_layout: memoryLayout as TensorMemoryLayout,
            shard_spec: shardSpec,
        };
    }

    return null;
};

/**
 * Whether the operation details view parses this argument as a memory config. Looser than
 * `isMemoryConfigValue`, which decides what counts as a request.
 */
export const isParsableMemoryConfigArgument = ({ name, value }: { name: string; value: string }): boolean =>
    name === 'memory_config' || trailingMemoryConfigPattern.test(value);

/** Whether a raw argument value is a whole `MemoryConfig(...)`, whatever buffer type it declares. */
export const isMemoryConfigValue = (value: string | null | undefined): value is string =>
    value != null && wholeMemoryConfigPattern.test(value);

/**
 * The buffer type a raw `MemoryConfig(...)` string declares, mirroring the backend's
 * `parse_memory_config_buffer_type`. Kept out of `parseMemoryConfig`, whose result the
 * operation details view renders key by key.
 */
export const getMemoryConfigBufferType = (value: string | null | undefined): BufferType | null => {
    const body = value?.match(wholeMemoryConfigPattern)?.[1];
    const name = body?.match(bufferTypePattern)?.[1];

    return name !== undefined && Object.hasOwn(StringBufferTypeToBufferType, name)
        ? StringBufferTypeToBufferType[name as StringBufferType]
        : null;
};

export const MEMORY_CONFIG_HEADERS = {
    shard_spec: 'ShardSpec',
    memory_layout: 'MemoryLayout',
    grid: 'CoreRangeSet',
    shape: 'Shape',
    orientation: 'ShardOrientation',
    halo: 'Halo',
    mode: 'Mode',
    physical_shard_shape: 'PhysicalShardShape',
};

export function getMemoryConfigHeader(key: MemoryKeys) {
    return MEMORY_CONFIG_HEADERS[key];
}

export default parseMemoryConfig;
