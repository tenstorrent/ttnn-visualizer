// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { getBufferKey, summariseOperationBuffers } from '../src/functions/summariseOperationBuffers';
import { BufferType } from '../src/model/BufferType';
import { buildBufferData } from './helpers/operationDetailsFixtures';

const SHARED_ADDRESS = 0x4000;

const keysOf = (buffers: ReturnType<typeof summariseOperationBuffers>) =>
    buffers.map((buffer) => getBufferKey(buffer.buffer_type, buffer.address)).sort();

describe('summariseOperationBuffers (#2078)', () => {
    const largerDram = buildBufferData({
        address: SHARED_ADDRESS,
        buffer_type: BufferType.DRAM,
        max_size_per_bank: 4096,
    });
    const smallerL1 = buildBufferData({ address: SHARED_ADDRESS, buffer_type: BufferType.L1, max_size_per_bank: 1024 });

    // DRAM and L1 are separate address spaces; sharing an address is a coincidence.
    it.each([
        ['DRAM first', [largerDram, smallerL1]],
        ['L1 first', [smallerL1, largerDram]],
    ])('keeps a smaller L1 buffer beside a larger DRAM buffer at its address (%s)', (_order, buffers) => {
        expect(keysOf(summariseOperationBuffers(buffers))).toEqual(
            [getBufferKey(BufferType.DRAM, SHARED_ADDRESS), getBufferKey(BufferType.L1, SHARED_ADDRESS)].sort(),
        );
    });

    it('keeps a smaller DRAM buffer beside a larger L1 buffer at its address', () => {
        const largerL1 = buildBufferData({
            address: SHARED_ADDRESS,
            buffer_type: BufferType.L1,
            max_size_per_bank: 8192,
        });
        const smallerDram = buildBufferData({
            address: SHARED_ADDRESS,
            buffer_type: BufferType.DRAM,
            max_size_per_bank: 512,
        });

        expect(summariseOperationBuffers([largerL1, smallerDram])).toEqual([largerL1, smallerDram]);
    });

    it('keeps the larger of two buffers of one type at one address', () => {
        const larger = buildBufferData({ address: SHARED_ADDRESS, max_size_per_bank: 2048 });
        const smaller = buildBufferData({ address: SHARED_ADDRESS, max_size_per_bank: 1024 });

        expect(summariseOperationBuffers([smaller, larger])).toEqual([larger]);
    });

    it('collapses one buffer across devices into a single entry', () => {
        const buffers = [0, 1].map((deviceId) => buildBufferData({ address: SHARED_ADDRESS, device_id: deviceId }));

        expect(summariseOperationBuffers(buffers)).toHaveLength(1);
    });
});
