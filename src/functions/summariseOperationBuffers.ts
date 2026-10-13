// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { BufferData } from '../model/APIData';
import { BufferType } from '../model/BufferType';

/**
 * Identity of a buffer within one operation. DRAM, L1 and L1 Small are
 * separate address spaces, so an address is only unique within a type: key
 * Operation Details' buffer-identity maps through this rather than by address
 * alone. The late-deallocation report still matches tensors by address. #2078
 */
export const getBufferKey = (bufferType: BufferType, address: number): string => `${bufferType}:${address}`;

/**
 * One buffer per `(buffer_type, address)`, keeping the largest per bank. Devices
 * are collapsed on purpose: the Operation Details plots show the per-bank peak.
 */
export const summariseOperationBuffers = (buffers: BufferData[]): BufferData[] => {
    const uniqueBuffers = new Map<string, BufferData>();

    buffers.forEach((buffer) => {
        // Skips address 0 as well as a missing address; whether a real DRAM buffer
        // can sit at 0 is unverified, so this keeps the long-standing behaviour.
        if (!buffer.address) {
            return;
        }

        const key = getBufferKey(buffer.buffer_type, buffer.address);
        const existingBuffer = uniqueBuffers.get(key);

        if (!existingBuffer || buffer.max_size_per_bank > existingBuffer.max_size_per_bank) {
            uniqueBuffers.set(key, buffer);
        }
    });

    return Array.from(uniqueBuffers.values());
};
