// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { OperationDescription, Tensor } from '../../src/model/APIData';
import { withParsedMemoryConfig } from '../../src/functions/parseMemoryConfig';
import { BufferType } from '../../src/model/BufferType';

/**
 * A memory config argument as tt-metal stores it, in the newer `nd_shard_spec` form. Pass a
 * `StringBufferType` member; the type is a plain string so a test can also pass one this app
 * does not know.
 */
export const makeMemoryConfigArgument = (bufferType: string, name = 'memory_config') =>
    withParsedMemoryConfig({
        name,
        value: `MemoryConfig(memory_layout=TensorMemoryLayout::INTERLEAVED,buffer_type=BufferType::${bufferType},shard_spec=std::nullopt,nd_shard_spec=std::nullopt,created_with_nd_shard_spec=0)`,
    });

/**
 * A tensor argument's repr as reports print it, with `memoryConfig` mid-string. Pass `data` to
 * print values first, which may span lines. No capture checked so far has a multi-line repr
 * that contains a memory config; the form guards the pattern's anchoring all the same.
 */
export const makeTensorRepr = (memoryConfig: string, data: string | null = null) =>
    `ttnn.Tensor(${data != null ? `${data}, ` : ''}shape=Shape([1, 1000]), dtype=DataType.BFLOAT16, layout=Layout.TILE, memory_config=${memoryConfig}, storage_type=StorageType.DEVICE, tensor_id=214, placements=['PlacementReplicate()'])`;

export const makeTensor = (overrides: Partial<Tensor> = {}): Tensor =>
    ({
        id: 1,
        address: null,
        buffer_type: BufferType.L1,
        device_id: 0,
        producers: [],
        consumers: [],
        producerNames: [],
        consumerNames: [],
        shape: 'Shape([1, 1, 32, 32])',
        ...overrides,
    }) as Tensor;

/** Only the fields the perf view's derivations read; cast because the rest are UI-only. */
export const makeOperation = (overrides: Partial<OperationDescription> = {}): OperationDescription =>
    ({
        id: 1,
        name: 'ttnn.add',
        arguments: [],
        inputs: [],
        outputs: [],
        device_operations: [],
        error: null,
        ...overrides,
    }) as unknown as OperationDescription;
