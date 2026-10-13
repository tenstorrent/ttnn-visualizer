// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { BufferData, Tensor } from '../src/model/APIData';
import { BufferType } from '../src/model/BufferType';
import { OperationDetails } from '../src/model/OperationDetails';
import { PlotDataCustom } from '../src/model/PlotData';
import { getBufferColor, getTensorColor } from '../src/functions/colorGenerator';
import { summariseOperationBuffers } from '../src/functions/summariseOperationBuffers';
import { buildTensorDeallocationReport } from './helpers/lateDeallocationFixtures';
import {
    buildBufferData,
    buildOperationDescription,
    buildOperationDetails,
    buildTensor,
} from './helpers/operationDetailsFixtures';

// DRAM and L1 are separate address spaces, so one address can hold a different
// tensor in each. Every lookup below has to stay within its own space. #2078
const SHARED_ADDRESS = 0x4000;
const OPERATION_ID = 1;
const L1_TENSOR_ID = 10;
const DRAM_TENSOR_ID = 20;

const l1Tensor = buildTensor({
    id: L1_TENSOR_ID,
    address: SHARED_ADDRESS,
    buffer_type: BufferType.L1,
    producers: [OPERATION_ID],
});
const dramTensor = buildTensor({
    id: DRAM_TENSOR_ID,
    address: SHARED_ADDRESS,
    buffer_type: BufferType.DRAM,
    producers: [OPERATION_ID],
});

// The DRAM buffer is the larger one: an address-only summary used to keep it
// and drop the L1 buffer.
const dramBuffer = buildBufferData({ address: SHARED_ADDRESS, buffer_type: BufferType.DRAM, max_size_per_bank: 4096 });
const l1Buffer = buildBufferData({ address: SHARED_ADDRESS, buffer_type: BufferType.L1, max_size_per_bank: 1024 });

interface BuildOptions {
    buffers: BufferData[];
    outputs: Tensor[];
    deallocationAddress?: number;
}

// Built through `summariseOperationBuffers`, as `useOperationDetails` does, so
// the spec exercises the summary rather than a hand-written one.
const buildDetails = ({ buffers, outputs, deallocationAddress }: BuildOptions): OperationDetails =>
    buildOperationDetails({
        data: { id: OPERATION_ID, buffers, buffersSummary: summariseOperationBuffers(buffers) },
        operations: [buildOperationDescription({ id: OPERATION_ID, name: 'matmul', outputs })],
        deallocationReport:
            deallocationAddress === undefined ? [] : [buildTensorDeallocationReport({ address: deallocationAddress })],
    });

const chunkAt = (details: OperationDetails, bufferType: BufferType) =>
    details.memoryData(bufferType).memory.find((chunk) => chunk.address === SHARED_ADDRESS);

const barAt = (details: OperationDetails, bufferType: BufferType) =>
    (details.memoryData(bufferType).chartData as PlotDataCustom[]).find(
        (bar) => bar.memoryData.address === SHARED_ADDRESS,
    );

describe.each([
    ['DRAM buffer first', [dramBuffer, l1Buffer]],
    ['L1 buffer first', [l1Buffer, dramBuffer]],
])('OperationDetails with an L1 and a DRAM tensor at one address (%s)', (_order, buffers) => {
    const details = buildDetails({ buffers, outputs: [dramTensor, l1Tensor] });

    it.each([
        ['L1', BufferType.L1, L1_TENSOR_ID],
        ['DRAM', BufferType.DRAM, DRAM_TENSOR_ID],
    ])('gives the %s plot its own buffer and tensor', (_label, bufferType, tensorId) => {
        expect(chunkAt(details, bufferType)?.tensorId).toBe(tensorId);

        const bar = barAt(details, bufferType);
        expect(bar?.memoryData.tensor?.id).toBe(tensorId);
        expect(bar?.marker?.color).toBe(getTensorColor(tensorId));
    });

    it('keeps both tensors reachable by id, each named after its producer', () => {
        for (const tensorId of [L1_TENSOR_ID, DRAM_TENSOR_ID]) {
            expect(details.tensorListById.get(tensorId)?.producerNames).toEqual(['matmul']);
        }
    });

    it('resolves the L1 tensor for address-only callers', () => {
        expect(details.tensorListByAddress.get(SHARED_ADDRESS)?.id).toBe(L1_TENSOR_ID);
    });

    it('labels a multi-device DRAM group with the DRAM tensor', () => {
        const [entry] = details.getGroupedMemoryReport(BufferType.DRAM).get(SHARED_ADDRESS) ?? [];

        expect(entry?.tensorId).toBe(DRAM_TENSOR_ID);
    });
});

describe('OperationDetails at a shared L1/DRAM address (#2078)', () => {
    it('flags only the L1 chunk as a late deallocation', () => {
        const details = buildDetails({
            buffers: [dramBuffer, l1Buffer],
            outputs: [dramTensor, l1Tensor],
            deallocationAddress: SHARED_ADDRESS,
        });

        expect(chunkAt(details, BufferType.L1)?.lateDeallocation).toBe(true);
        expect(chunkAt(details, BufferType.DRAM)?.lateDeallocation).toBe(false);
    });

    it('does not lend the L1 tensor to a DRAM buffer that has none of its own', () => {
        const details = buildDetails({ buffers: [dramBuffer, l1Buffer], outputs: [l1Tensor] });
        const bar = barAt(details, BufferType.DRAM);

        expect(chunkAt(details, BufferType.DRAM)?.tensorId).toBeUndefined();
        expect(bar?.memoryData.tensor).toBeNull();
        // Buffer and tensor colours cycle the same palette, so assert the buffer
        // colour rather than "not the tensor's", which can coincide.
        expect(bar?.marker?.color).toBe(getBufferColor(SHARED_ADDRESS));
    });

    it('does not lend the L1 tensor to the L1 Small condensed stripe', () => {
        const l1SmallBuffer = buildBufferData({ address: SHARED_ADDRESS, buffer_type: BufferType.L1_SMALL });
        const details = buildDetails({ buffers: [l1Buffer, l1SmallBuffer], outputs: [l1Tensor] });
        const [stripe] = details.memoryData(BufferType.L1_SMALL).condensedChart as PlotDataCustom[];

        expect(stripe.memoryData.tensor).toBeNull();
    });

    it('still matches a tensor whose buffer type was not recorded', () => {
        const untypedTensor = buildTensor({ id: L1_TENSOR_ID, address: SHARED_ADDRESS, buffer_type: null });
        const details = buildDetails({ buffers: [l1Buffer], outputs: [untypedTensor] });

        expect(chunkAt(details, BufferType.L1)?.tensorId).toBe(L1_TENSOR_ID);
    });
});
