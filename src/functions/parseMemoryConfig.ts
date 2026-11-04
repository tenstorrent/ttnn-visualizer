// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { MemoryConfig, MemoryKeys, ShardSpec, TensorMemoryLayout } from '../model/MemoryConfig';
import { BufferType, toBufferType } from '../model/BufferType';

// Anchored at both ends, like the backend's `re.match` with its `$`, so a tensor argument whose
// repr merely contains a memory config is not read as one. Older reports namespace the type.
// `[^\n]*` is Python's `.`, which unlike JavaScript's also takes `\r`, U+2028 and U+2029, and
// `\n?` is Python's `$`, which also allows one trailing newline.
const memoryConfigPattern = /^(?:tt::tt_metal::)?MemoryConfig\(([^\n]*)\)\n?$/;
const bufferTypePattern = /buffer_type=BufferType::([A-Z0-9_]+)/;
const memoryLayoutPattern = /memory_layout=([A-Za-z_:]+)/;
const shardSpecPattern =
    /shard_spec=ShardSpec\((?:grid=\{(\[.*?\])\},?)?(?:shape=\{(\d+), (\d+)\},?)?(?:orientation=ShardOrientation::([A-Za-z_]+),?)?(?:halo=(\d+),?)?(?:mode=ShardMode::([A-Z_]+),?)?(?:physical_shard_shape=std::([A-Za-z_]+),?)?/;

/** What sits inside a raw `MemoryConfig(...)` string, or null if it isn't one, like the backend's `_memory_config_body`. */
const getMemoryConfigBody = (value: string | null | undefined): string | null =>
    value?.match(memoryConfigPattern)?.[1] ?? null;

const parseMemoryConfig = (string: string | null | undefined): MemoryConfig | null => {
    const capturedString = getMemoryConfigBody(string);

    if (capturedString != null) {
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
 * An operation argument with its `parsedValue`, which the operation details view renders key by
 * key: the parsed config when the value is a whole `MemoryConfig(...)`, otherwise null.
 */
export const withParsedMemoryConfig = <Argument extends { value: string }>(
    argument: Argument,
): Argument & { parsedValue: MemoryConfig | null } => ({ ...argument, parsedValue: parseMemoryConfig(argument.value) });

/** Whether a raw argument value is a whole `MemoryConfig(...)`, whatever buffer type it declares. */
export const isMemoryConfigValue = (value: string | null | undefined): value is string =>
    getMemoryConfigBody(value) != null;

/**
 * The buffer type a raw `MemoryConfig(...)` string declares, mirroring the backend's
 * `parse_memory_config_buffer_type`. Kept out of `parseMemoryConfig`, whose result the
 * operation details view renders key by key.
 */
export const getMemoryConfigBufferType = (value: string | null | undefined): BufferType | null =>
    toBufferType(getMemoryConfigBody(value)?.match(bufferTypePattern)?.[1]);

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
