// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OperationDetailsComponent from '../src/components/operation-details/OperationDetailsComponent';
import { BufferType } from '../src/model/BufferType';
import { selectedAddressAtom, selectedTensorIdAtom } from '../src/store/app';
import { summariseOperationBuffers } from '../src/functions/summariseOperationBuffers';
import { TestProviders } from './helpers/TestProviders';
import {
    buildBufferData,
    buildOperationDescription,
    buildOperationDetailsData,
    buildTensor,
} from './helpers/operationDetailsFixtures';

// A plot click selects a tensor by id and address. When that tensor is not an
// input or output of the open operation, the panel used to look it up by
// address alone, and an L1 tensor at the same address took the DRAM one's
// place. #2078
const SHARED_ADDRESS = 0x4000;
const PRODUCER_ID = 0;
const OPERATION_ID = 1;
const L1_TENSOR_ID = 10;
const DRAM_TENSOR_ID = 20;

// Built when the hooks run, not when the hoisted mock factory does: the
// constants above are not initialised by then.
function sharedAddressBuffers() {
    return [
        buildBufferData({ address: SHARED_ADDRESS, buffer_type: BufferType.DRAM, max_size_per_bank: 128 }),
        buildBufferData({ address: SHARED_ADDRESS, buffer_type: BufferType.L1, max_size_per_bank: 4096 }),
    ];
}

// Both tensors come from an earlier operation, so neither is an input or output
// of the open one.
function sharedAddressOperations() {
    return [
        buildOperationDescription({
            id: PRODUCER_ID,
            name: 'producer',
            outputs: [
                buildTensor({
                    id: L1_TENSOR_ID,
                    address: SHARED_ADDRESS,
                    buffer_type: BufferType.L1,
                    producers: [PRODUCER_ID],
                }),
                buildTensor({
                    id: DRAM_TENSOR_ID,
                    address: SHARED_ADDRESS,
                    buffer_type: BufferType.DRAM,
                    producers: [PRODUCER_ID],
                }),
            ],
        }),
        buildOperationDescription({ id: OPERATION_ID, name: 'consumer' }),
    ];
}

vi.mock('../src/hooks/useAPI', () => ({
    useOperationsList: () => ({ data: sharedAddressOperations() }),
    useGetL1StartMarker: () => 0,
    useGetL1SmallMarker: () => 1_500_000,
    useTensors: () => ({ data: [] }),
    useOperationDetails: (operationId: number) => ({
        operationDetails: {
            data: buildOperationDetailsData({
                id: operationId,
                buffers: sharedAddressBuffers(),
                buffersSummary: summariseOperationBuffers(sharedAddressBuffers()),
            }),
            isLoading: false,
            status: 'success',
        },
    }),
    usePreviousOperationDetails: (operationId: number) => ({
        operationDetails: { data: buildOperationDetailsData({ id: operationId - 1 }), isLoading: false },
    }),
    useGetTensorDeallocationReportByOperation: () => ({
        lateDeallocationsByOperation: new Map(),
        nonDeallocatedTensorList: new Map(),
        status: 'success',
        operationRange: null,
    }),
}));

// Only the producer/consumer panel matters here; the rest is covered elsewhere.
vi.mock('../src/components/operation-details/L1Plots', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/DRAMPlots', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/MemoryPlotRenderer', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/StackTrace', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/DeviceOperationsGraphComponent', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/DeviceOperationsFullRender', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/TensorDetailsList', () => ({ default: () => null }));
vi.mock('../src/components/OperationArguments', () => ({ default: () => null }));
vi.mock('../src/components/OperationDetailsNavigation', () => ({ default: () => null }));

afterEach(cleanup);

describe('OperationDetailsComponent producer/consumer panel at a shared address (#2078)', () => {
    it('shows the selected DRAM tensor, not the L1 tensor at its address', () => {
        render(
            <TestProviders
                initialAtomValues={[
                    [selectedTensorIdAtom, DRAM_TENSOR_ID],
                    [selectedAddressAtom, SHARED_ADDRESS],
                ]}
            >
                <OperationDetailsComponent operationId={OPERATION_ID} />
            </TestProviders>,
        );

        expect(screen.getByRole('heading', { name: `Tensor ${DRAM_TENSOR_ID}` })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: `Tensor ${L1_TENSOR_ID}` })).not.toBeInTheDocument();
    });
});
