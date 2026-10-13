// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { BufferAllocateNode, BufferDeallocateNode, BufferNode, TensorNode } from '../model/APIData';
import {
    BufferType,
    BufferTypeToStringBufferType,
    StringBufferType,
    StringBufferTypeToBufferType,
    toBufferType,
} from '../model/BufferType';

type MemoryNode = BufferNode | BufferAllocateNode | BufferDeallocateNode | TensorNode;

/**
 * The memory space a graph node sits in. The numeric `buffer_type` comes first:
 * tt-metal writes the string `type` as `is_dram() ? 'DRAM' : 'L1'`, so an L1
 * Small buffer reads `'L1'` there. A tensor node may carry neither, in which
 * case its buffers say. `buffer` is indexed by device id, so it can have holes.
 */
export const getNodeBufferType = (node: MemoryNode): BufferType | undefined => {
    const buffer = node.buffer?.find((candidate) => candidate);
    const stringType = node.params.type ?? buffer?.params.type;

    return (
        toBufferType(node.params.buffer_type) ??
        toBufferType(buffer?.params.buffer_type) ??
        (stringType !== undefined ? StringBufferTypeToBufferType.get(stringType) : undefined)
    );
};

/** `getNodeBufferType` in the string form legends and tags take. */
export const getNodeStringBufferType = (node: MemoryNode): StringBufferType | undefined => {
    const bufferType = getNodeBufferType(node);

    return bufferType !== undefined ? BufferTypeToStringBufferType[bufferType] : node.params.type;
};
