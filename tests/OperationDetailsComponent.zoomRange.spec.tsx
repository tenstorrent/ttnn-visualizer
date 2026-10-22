// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OperationDetailsComponent from '../src/components/operation-details/OperationDetailsComponent';
import { BufferType } from '../src/model/BufferType';
import { summariseOperationBuffers } from '../src/functions/summariseOperationBuffers';
import { TestProviders } from './helpers/TestProviders';
import {
    buildBufferData,
    buildOperationDescription,
    buildOperationDetailsData,
    buildTensor,
} from './helpers/operationDetailsFixtures';

const OPERATION_ID = 1;
const TENSOR_A_ID = 10;
const TENSOR_B_ID = 11;
const ADDRESS_LOW = 16384;
const ADDRESS_HIGH = 65536;

function inputTensors() {
    return [
        buildTensor({ id: TENSOR_A_ID, address: ADDRESS_LOW, buffer_type: BufferType.L1, producers: [0] }),
        buildTensor({ id: TENSOR_B_ID, address: ADDRESS_HIGH, buffer_type: BufferType.L1, producers: [0] }),
    ];
}

function inputBuffers() {
    return [
        buildBufferData({ address: ADDRESS_LOW, buffer_type: BufferType.L1, max_size_per_bank: 4096 }),
        buildBufferData({ address: ADDRESS_HIGH, buffer_type: BufferType.L1, max_size_per_bank: 4096 }),
    ];
}

vi.mock('../src/hooks/useAPI', () => ({
    useGetClusterDescription: () => ({ data: undefined }),
    useOperationsList: () => ({
        data: [
            buildOperationDescription({ id: 0, name: 'producer', outputs: inputTensors() }),
            buildOperationDescription({ id: OPERATION_ID, name: 'consumer', inputs: inputTensors() }),
        ],
    }),
    useGetL1StartMarker: () => 0,
    useGetL1SmallMarker: () => 1_500_000,
    useTensors: () => ({ data: [] }),
    useOperationDetails: (operationId: number) => ({
        operationDetails: {
            data: buildOperationDetailsData({
                id: operationId,
                inputs: inputTensors(),
                buffers: inputBuffers(),
                buffersSummary: summariseOperationBuffers(inputBuffers()),
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
vi.mock('../src/components/OperationArguments', () => ({ default: () => null }));
vi.mock('../src/components/OperationDetailsNavigation', () => ({ default: () => null }));

afterEach(cleanup);

describe('OperationDetailsComponent L1 memory zoom range reset (#2150)', () => {
    it('does not reset the narrowed range when clicking the label text, and resets when clicking the reset button', () => {
        render(
            <TestProviders>
                <OperationDetailsComponent operationId={OPERATION_ID} />
            </TestProviders>,
        );

        const resetButton = screen.getByRole('button', { name: 'Reset L1 memory zoom range' });
        expect(resetButton).toBeDisabled();

        fireEvent.click(screen.getByLabelText('Buffer zoom'));
        expect(resetButton).toBeDisabled();

        const [lowerHandle] = screen.getAllByRole('slider');
        const initialMin = lowerHandle.getAttribute('aria-valuenow');
        fireEvent.keyDown(lowerHandle, { key: 'ArrowRight' });
        const narrowedMin = lowerHandle.getAttribute('aria-valuenow');
        expect(narrowedMin).not.toBe(initialMin);
        expect(resetButton).toBeEnabled();

        // Clicking the label text must not activate the nested reset button.
        fireEvent.click(screen.getByText(/L1 memory zoom range/));
        expect(lowerHandle).toHaveAttribute('aria-valuenow', narrowedMin);
        expect(resetButton).toBeEnabled();

        // Clicking the reset button itself resets the range.
        fireEvent.click(resetButton);
        expect(lowerHandle).toHaveAttribute('aria-valuenow', initialMin);
        expect(resetButton).toBeDisabled();
    });
});
