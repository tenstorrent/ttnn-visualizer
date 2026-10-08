// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { OperationDescription, Tensor } from '../../src/model/APIData';
import { BufferType } from '../../src/model/BufferType';

/** A memory config argument as tt-metal stores it, in the newer `nd_shard_spec` form. */
export const memoryConfigArgument = (bufferType: string, name = 'memory_config') => ({
    name,
    value: `MemoryConfig(memory_layout=TensorMemoryLayout::INTERLEAVED,buffer_type=BufferType::${bufferType},shard_spec=std::nullopt,nd_shard_spec=std::nullopt,created_with_nd_shard_spec=0)`,
    parsedValue: null,
});

export const makeTensor = (overrides: Partial<Tensor> = {}): Tensor =>
    ({
        id: 1,
        address: null,
        buffer_type: BufferType.L1,
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
