// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { getMemoryConfigBufferType } from '../src/functions/parseMemoryConfig';
import { BufferType } from '../src/model/BufferType';
import { memoryConfigArgument } from './helpers/operationDescription';

// The older form, without the nd_shard_spec fields.
const SHARDED_L1 =
    'MemoryConfig(memory_layout=TensorMemoryLayout::HEIGHT_SHARDED,buffer_type=BufferType::L1,shard_spec=ShardSpec(grid={[(x=0,y=0) - (x=7,y=7)]},shape={32, 64},orientation=ShardOrientation::ROW_MAJOR,halo=0))';

describe('getMemoryConfigBufferType', () => {
    it.each([
        ['L1', BufferType.L1],
        ['L1_SMALL', BufferType.L1_SMALL],
        ['DRAM', BufferType.DRAM],
    ])('reads BufferType::%s from the newer nd_shard_spec form', (name, expected) => {
        expect(getMemoryConfigBufferType(memoryConfigArgument(name).value)).toBe(expected);
    });

    it('reads the older form with a shard spec', () => {
        expect(getMemoryConfigBufferType(SHARDED_L1)).toBe(BufferType.L1);
    });

    it('is null when the config declares no buffer type', () => {
        expect(
            getMemoryConfigBufferType(
                'MemoryConfig(memory_layout=TensorMemoryLayout::INTERLEAVED,shard_spec=std::nullopt)',
            ),
        ).toBeNull();
    });

    it('is null for a buffer type this app does not know', () => {
        expect(getMemoryConfigBufferType(memoryConfigArgument('FUTURE_MEMORY').value)).toBeNull();
    });

    it('is null for a value that only ends in a memory config', () => {
        expect(getMemoryConfigBufferType(`ttnn.Tensor(..., memory_config=${SHARDED_L1}`)).toBeNull();
    });

    it.each([null, undefined, '', 'std::nullopt'])('is null for %s', (value) => {
        expect(getMemoryConfigBufferType(value)).toBeNull();
    });
});
