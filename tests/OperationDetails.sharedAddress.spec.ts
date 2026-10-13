// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { PlotData } from 'plotly.js';
import { BufferData, Node, NodeType, Tensor } from '../src/model/APIData';
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
    createNodeFactory,
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

    it.each([
        ['DRAM', BufferType.DRAM, DRAM_TENSOR_ID],
        ['L1', BufferType.L1, L1_TENSOR_ID],
        ['no', undefined, L1_TENSOR_ID],
    ])('resolves a graph node in %s memory space', (_label, bufferType, tensorId) => {
        const details = buildDetails({ buffers: [dramBuffer, l1Buffer], outputs: [dramTensor, l1Tensor] });

        expect(details.getTensorForNode(SHARED_ADDRESS, bufferType)?.id).toBe(tensorId);
    });
});

// A tensor with no recorded type matches every buffer at its address, so one
// id reaches both memory spaces. The id lookup has to agree with the address
// lookup on which copy it returns, whichever buffer comes first.
describe.each([
    ['DRAM buffer first', [dramBuffer, l1Buffer]],
    ['L1 buffer first', [l1Buffer, dramBuffer]],
])('OperationDetails with an untyped tensor at a shared address (%s)', (_order, buffers) => {
    const UNTYPED_TENSOR_ID = 30;
    const details = buildDetails({
        buffers,
        outputs: [buildTensor({ id: UNTYPED_TENSOR_ID, address: SHARED_ADDRESS, buffer_type: null })],
    });

    it('gives both plots the tensor', () => {
        expect(chunkAt(details, BufferType.L1)?.tensorId).toBe(UNTYPED_TENSOR_ID);
        expect(chunkAt(details, BufferType.DRAM)?.tensorId).toBe(UNTYPED_TENSOR_ID);
    });

    it('keeps the L1 copy for id and address lookups', () => {
        expect(details.tensorListById.get(UNTYPED_TENSOR_ID)?.buffer_type).toBe(BufferType.L1);
        expect(details.tensorListByAddress.get(SHARED_ADDRESS)?.buffer_type).toBe(BufferType.L1);
    });

    it('keeps each memory space its own copy', () => {
        expect(details.getTensorForBuffer(SHARED_ADDRESS, BufferType.L1)?.buffer_type).toBe(BufferType.L1);
        expect(details.getTensorForBuffer(SHARED_ADDRESS, BufferType.DRAM)?.buffer_type).toBe(BufferType.DRAM);
    });

    it("gives each plot's bar its own space's copy", () => {
        expect(barAt(details, BufferType.L1)?.memoryData.tensor?.buffer_type).toBe(BufferType.L1);
        expect(barAt(details, BufferType.DRAM)?.memoryData.tensor?.buffer_type).toBe(BufferType.DRAM);
    });
});

// Device-operation chunks come from graph nodes whose string `type` reads
// `'L1'` for L1 Small too, so conv and pool CBs aliased over L1 Small tensors
// must still find them.
describe('OperationDetails device-operation bars over an L1 Small tensor', () => {
    const L1_SMALL_TENSOR_ID = 30;
    const l1SmallBuffer = buildBufferData({ address: SHARED_ADDRESS, buffer_type: BufferType.L1_SMALL });
    const l1SmallTensor = buildTensor({
        id: L1_SMALL_TENSOR_ID,
        address: SHARED_ADDRESS,
        buffer_type: BufferType.L1_SMALL,
        producers: [OPERATION_ID],
    });

    const buildWithGraph = (memoryNode: Partial<Node>) => {
        const mkNode = createNodeFactory();
        const deviceOperations = [
            mkNode({ node_type: NodeType.function_start, params: { name: 'conv2d' } } as unknown as Partial<Node>),
            mkNode(memoryNode),
            mkNode({ node_type: NodeType.function_end, params: { name: 'conv2d' } } as unknown as Partial<Node>),
        ];

        return buildOperationDetails({
            data: {
                id: OPERATION_ID,
                buffers: [l1SmallBuffer],
                buffersSummary: summariseOperationBuffers([l1SmallBuffer]),
                device_operations: deviceOperations,
            },
            operations: [buildOperationDescription({ id: OPERATION_ID, name: 'conv2d', outputs: [l1SmallTensor] })],
        });
    };

    const tensorIdsAt = (traces: Partial<PlotData>[] | undefined) =>
        (traces as PlotDataCustom[] | undefined)
            ?.filter((bar) => bar.memoryData.address === SHARED_ADDRESS)
            .map((bar) => bar.memoryData.tensor?.id);

    it('names the tensor under an aliased CB', () => {
        const details = buildWithGraph({
            node_type: NodeType.circular_buffer_allocate,
            params: {
                core_range_set: '{[(x=0,y=0) - (x=0,y=0)]}',
                size: '1024',
                address: String(SHARED_ADDRESS),
                globally_allocated: '1',
            },
        } as unknown as Partial<Node>);
        const [traces] = details.memoryData(BufferType.L1).cbChartDataByOperation.values();

        expect(tensorIdsAt(traces)).toEqual([L1_SMALL_TENSOR_ID]);
    });

    it("names the tensor under a device-operation buffer whose type reads 'L1'", () => {
        const details = buildWithGraph({
            node_type: NodeType.buffer_allocate,
            params: {
                address: String(SHARED_ADDRESS),
                size: '1024',
                num_cores: '1',
                type: 'L1',
                buffer_type: BufferType.L1_SMALL,
            },
        } as unknown as Partial<Node>);
        const [traces] = details.memoryData(BufferType.L1).bufferChartDataByOperation.values();

        expect(tensorIdsAt(traces)).toEqual([L1_SMALL_TENSOR_ID]);
    });
});
