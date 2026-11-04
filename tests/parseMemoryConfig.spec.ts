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
import { makeMemoryConfigArgument, makeTensorRepr } from './helpers/operationDescription';

// The older form, without the nd_shard_spec fields.
const SHARDED_L1 =
    'MemoryConfig(memory_layout=TensorMemoryLayout::HEIGHT_SHARDED,buffer_type=BufferType::L1,shard_spec=ShardSpec(grid={[(x=0,y=0) - (x=7,y=7)]},shape={32, 64},orientation=ShardOrientation::ROW_MAJOR,halo=0))';
// Tensor arguments hold a memory config mid-string; printed with their data, on the last line.
// Only an anchored pattern rejects both.
const TENSOR_REPR = makeTensorRepr(SHARDED_L1);
const MULTI_LINE_TENSOR_REPR = makeTensorRepr(SHARDED_L1, '[[1.0, 2.0],\n [3.0, 4.0]]');
// Values that contain a memory config without being one, labelled so test names stay readable.
const NOT_A_MEMORY_CONFIG: [string, string][] = [
    ['a tensor repr that contains a memory config', TENSOR_REPR],
    ['a multi-line tensor repr whose last line contains a memory config', MULTI_LINE_TENSOR_REPR],
    ['a value that only ends in a memory config', `ttnn.Tensor(..., memory_config=${SHARDED_L1}`],
    // The backend's `$` allows one trailing newline and no more; `test_utils.py` pins the same.
    ['a config with two trailing newlines', `${SHARDED_L1}\n\n`],
    ['a config with trailing whitespace', `${SHARDED_L1} `],
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

    it('parses a config with one trailing newline, as the backend does', () => {
        expect(parseMemoryConfig(`${SHARDED_L1}\n`)).toEqual(shardedL1);
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
        ['memory_config', TENSOR_REPR],
        ['memory_config', 'std::nullopt'],
        ['input_tensor', TENSOR_REPR],
    ])('gives a %s argument that is not a whole memory config a null parsedValue', (name, value) => {
        expect(withParsedMemoryConfig({ name, value })).toEqual({ name, value, parsedValue: null });
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

    it('reads a config with one trailing newline, as the backend does', () => {
        expect(getMemoryConfigBufferType(`${SHARDED_L1}\n`)).toBe(BufferType.L1);
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
    it.each([SHARDED_L1, `tt::tt_metal::${SHARDED_L1}`, `${SHARDED_L1}\n`])('accepts %j', (value) => {
        expect(isMemoryConfigValue(value)).toBe(true);
    });

    it.each([...NOT_A_MEMORY_CONFIG, ...EMPTY_VALUES, ['a config under another namespace', `other::${SHARDED_L1}`]])(
        'rejects %s',
        (_label, value) => {
            expect(isMemoryConfigValue(value)).toBe(false);
        },
    );
});
