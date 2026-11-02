// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import parseMemoryConfig, {
    getMemoryConfigBufferType,
    isMemoryConfigValue,
    withParsedMemoryConfig,
} from '../src/functions/parseMemoryConfig';
import { BufferType, StringBufferType } from '../src/model/BufferType';
import { makeMemoryConfigArgument } from './helpers/operationDescription';

// The older form, without the nd_shard_spec fields.
const SHARDED_L1 =
    'MemoryConfig(memory_layout=TensorMemoryLayout::HEIGHT_SHARDED,buffer_type=BufferType::L1,shard_spec=ShardSpec(grid={[(x=0,y=0) - (x=7,y=7)]},shape={32, 64},orientation=ShardOrientation::ROW_MAJOR,halo=0))';
// How reports print a tensor argument: the memory config sits mid-string, and the repr still
// ends in `)`, so a pattern unanchored at the start reads the whole tail as the config.
const TENSOR_REPR = `ttnn.Tensor(shape=Shape([1, 1000]), dtype=DataType.BFLOAT16, layout=Layout.TILE, memory_config=${SHARDED_L1}, storage_type=StorageType.DEVICE, tensor_id=214, is_allocated=True, mesh_coords=['MeshCoordinate([0, 0])'], distribution_shape=MeshShape([1]), placements=['PlacementReplicate()'])`;
// Values that contain a memory config without being one, labelled so test names stay readable.
const NOT_A_MEMORY_CONFIG: [string, string][] = [
    ['a tensor repr that contains a memory config', TENSOR_REPR],
    ['a value that only ends in a memory config', `ttnn.Tensor(..., memory_config=${SHARDED_L1}`],
];
const EMPTY_VALUES: [string, string | null | undefined][] = [
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['std::nullopt', 'std::nullopt'],
];

describe('parseMemoryConfig', () => {
    const shardedL1 = {
        memory_layout: 'TensorMemoryLayout::HEIGHT_SHARDED',
        shard_spec: { grid: '[(x=0,y=0) - (x=7,y=7)]', shape: [32, 64], orientation: 'ROW_MAJOR', halo: 0 },
    };

    it('parses a sharded config', () => {
        expect(parseMemoryConfig(SHARDED_L1)).toEqual(shardedL1);
    });

    it('parses the namespaced form older reports print', () => {
        expect(parseMemoryConfig(`tt::tt_metal::${SHARDED_L1}`)).toEqual(shardedL1);
    });

    it('parses an interleaved config without a shard spec', () => {
        expect(parseMemoryConfig(makeMemoryConfigArgument(StringBufferType.DRAM).value)).toEqual({
            memory_layout: 'TensorMemoryLayout::INTERLEAVED',
            shard_spec: 'std::nullopt',
        });
    });

    it('parses a sharded config in the newer nd_shard_spec form', () => {
        expect(
            parseMemoryConfig(
                'MemoryConfig(memory_layout=TensorMemoryLayout::BLOCK_SHARDED,buffer_type=BufferType::L1,shard_spec=ShardSpec(grid={[(x=0,y=0) - (x=7,y=7)]},shape={2048, 40},orientation=ShardOrientation::ROW_MAJOR),nd_shard_spec=std::nullopt,created_with_nd_shard_spec=0)',
            ),
        ).toMatchObject({
            memory_layout: 'TensorMemoryLayout::BLOCK_SHARDED',
            shard_spec: { grid: '[(x=0,y=0) - (x=7,y=7)]', shape: [2048, 40], orientation: 'ROW_MAJOR' },
        });
    });

    it.each([...NOT_A_MEMORY_CONFIG, ...EMPTY_VALUES])('is null for %s', (_label, value) => {
        expect(parseMemoryConfig(value)).toBeNull();
    });
});

describe('withParsedMemoryConfig', () => {
    it('parses an argument whose value is a whole memory config, whatever its name', () => {
        expect(withParsedMemoryConfig({ name: 'output_mem_config', value: SHARDED_L1 })).toEqual({
            name: 'output_mem_config',
            value: SHARDED_L1,
            parsedValue: parseMemoryConfig(SHARDED_L1),
        });
    });

    it.each([
        ['a tensor repr', TENSOR_REPR],
        ['std::nullopt', 'std::nullopt'],
    ])('leaves a memory_config argument holding %s unparsed', (_label, value) => {
        const argument = { name: 'memory_config', value };

        expect(withParsedMemoryConfig(argument)).toBe(argument);
    });
});

describe('getMemoryConfigBufferType', () => {
    it.each([
        [StringBufferType.L1, BufferType.L1],
        [StringBufferType.L1_SMALL, BufferType.L1_SMALL],
        [StringBufferType.DRAM, BufferType.DRAM],
    ])('reads BufferType::%s from the newer nd_shard_spec form', (name, expected) => {
        expect(getMemoryConfigBufferType(makeMemoryConfigArgument(name).value)).toBe(expected);
    });

    it('reads the older form with a shard spec', () => {
        expect(getMemoryConfigBufferType(SHARDED_L1)).toBe(BufferType.L1);
    });

    it('reads the namespaced form older reports print', () => {
        expect(getMemoryConfigBufferType(`tt::tt_metal::${SHARDED_L1}`)).toBe(BufferType.L1);
    });

    it('is null when the config declares no buffer type', () => {
        expect(
            getMemoryConfigBufferType(
                'MemoryConfig(memory_layout=TensorMemoryLayout::INTERLEAVED,shard_spec=std::nullopt)',
            ),
        ).toBeNull();
    });

    it('is null for a buffer type this app does not know', () => {
        expect(getMemoryConfigBufferType(makeMemoryConfigArgument('FUTURE_MEMORY').value)).toBeNull();
    });

    it.each([...NOT_A_MEMORY_CONFIG, ...EMPTY_VALUES])('is null for %s', (_label, value) => {
        expect(getMemoryConfigBufferType(value)).toBeNull();
    });
});

describe('isMemoryConfigValue', () => {
    it.each([SHARDED_L1, `tt::tt_metal::${SHARDED_L1}`])('accepts %s', (value) => {
        expect(isMemoryConfigValue(value)).toBe(true);
    });

    it.each([
        ...NOT_A_MEMORY_CONFIG,
        ['a config under another namespace', `other::${SHARDED_L1}`],
        ['null', null],
        ['undefined', undefined],
    ])('rejects %s', (_label, value) => {
        expect(isMemoryConfigValue(value)).toBe(false);
    });
});
