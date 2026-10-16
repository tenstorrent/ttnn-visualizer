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
import { BufferFocusProbe } from './helpers/BufferFocusProbe';
import { bufferFocus, pressAndRelease } from './helpers/bufferFocus';
import {
    buildBufferData,
    buildOperationDescription,
    buildOperationDetailsData,
    buildTensor,
} from './helpers/operationDetailsFixtures';

const ADDRESS = 0x4000;
const OPERATION_ID = 1;
const TENSOR_ID = 10;

function focusedBuffers() {
    return [buildBufferData({ address: ADDRESS, buffer_type: BufferType.L1, max_size_per_bank: 4096 })];
}

function focusedOperations() {
    return [
        buildOperationDescription({
            id: 0,
            name: 'producer',
            outputs: [buildTensor({ id: TENSOR_ID, address: ADDRESS, buffer_type: BufferType.L1, producers: [0] })],
        }),
        buildOperationDescription({ id: OPERATION_ID, name: 'consumer' }),
    ];
}

vi.mock('../src/hooks/useAPI', () => ({
    useOperationsList: () => ({ data: focusedOperations() }),
    useGetL1StartMarker: () => 0,
    useGetL1SmallMarker: () => 1_500_000,
    useTensors: () => ({ data: [] }),
    useOperationDetails: (operationId: number) => ({
        operationDetails: {
            data: buildOperationDetailsData({
                id: operationId,
                buffers: focusedBuffers(),
                buffersSummary: summariseOperationBuffers(focusedBuffers()),
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

vi.mock('../src/components/operation-details/L1Plots', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/DRAMPlots', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/MemoryPlotRenderer', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/StackTrace', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/DeviceOperationsGraphComponent', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/DeviceOperationsFullRender', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/TensorDetailsList', () => ({ default: () => null }));
vi.mock('../src/components/OperationArguments', () => ({ default: () => null }));
vi.mock('../src/components/OperationDetailsNavigation', () => ({ default: () => null }));

const renderFocused = () =>
    render(
        <TestProviders
            initialAtomValues={[
                [selectedTensorIdAtom, TENSOR_ID],
                [selectedAddressAtom, ADDRESS],
            ]}
        >
            <OperationDetailsComponent operationId={OPERATION_ID} />
            <BufferFocusProbe />
        </TestProviders>,
    );

afterEach(cleanup);

describe('OperationDetailsComponent dismissing a focused buffer (#2042)', () => {
    it('dismisses it on a click that lands on content', () => {
        renderFocused();
        expect(bufferFocus()).toHaveTextContent('focused');

        pressAndRelease(screen.getByRole('heading', { name: 'L1 Memory' }));

        expect(bufferFocus()).toHaveTextContent('dismissed');
    });

    it('keeps it through a click on a control, which acts on its own', () => {
        renderFocused();

        pressAndRelease(screen.getByRole('button', { name: 'DRAM' }));

        expect(bufferFocus()).toHaveTextContent('focused');
    });

    it('keeps it through a click in the panel describing the focused tensor', () => {
        renderFocused();

        pressAndRelease(screen.getByRole('heading', { name: `Tensor ${TENSOR_ID}` }));

        expect(bufferFocus()).toHaveTextContent('focused');
    });
});
