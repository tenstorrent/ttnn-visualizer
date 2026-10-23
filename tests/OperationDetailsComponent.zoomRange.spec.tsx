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

const REQUIRES_BUFFER_ZOOM_HINT = '(Requires buffer zoom to be enabled)';

function renderComponent() {
    render(
        <TestProviders>
            <OperationDetailsComponent operationId={OPERATION_ID} />
        </TestProviders>,
    );

    const [lowerHandle, upperHandle] = screen.getAllByRole('slider');

    return {
        resetButton: screen.getByRole('button', { name: 'Reset L1 memory zoom range' }),
        // The text is a direct child of the range container, so this resolves to the container itself.
        rangeLabel: screen.getByText(/L1 memory zoom range/),
        lowerHandle,
        upperHandle,
    };
}

function enableBufferZoom() {
    fireEvent.click(screen.getByLabelText('Buffer zoom'));
}

describe('OperationDetailsComponent L1 memory zoom range reset (#2150)', () => {
    it('marks the range label disabled until buffer zoom is enabled', () => {
        const { rangeLabel } = renderComponent();

        expect(rangeLabel).toHaveClass('memory-zoom-range-label', 'disabled');
        expect(rangeLabel).toHaveTextContent(REQUIRES_BUFFER_ZOOM_HINT);

        enableBufferZoom();

        expect(rangeLabel).not.toHaveClass('disabled');
        expect(rangeLabel).not.toHaveTextContent(REQUIRES_BUFFER_ZOOM_HINT);
    });

    it('keeps reset disabled until buffer zoom is enabled and the range is narrowed', () => {
        const { resetButton, lowerHandle } = renderComponent();

        expect(resetButton).toBeDisabled();

        enableBufferZoom();
        expect(resetButton).toBeDisabled();

        fireEvent.keyDown(lowerHandle, { key: 'ArrowRight' });
        expect(resetButton).toBeEnabled();
    });

    it('does not reset the narrowed range when clicking the label text', () => {
        const { resetButton, rangeLabel, lowerHandle } = renderComponent();

        enableBufferZoom();
        fireEvent.keyDown(lowerHandle, { key: 'ArrowRight' });
        const narrowedMin = lowerHandle.getAttribute('aria-valuenow');

        fireEvent.click(rangeLabel);

        expect(lowerHandle).toHaveAttribute('aria-valuenow', narrowedMin);
        expect(resetButton).toBeEnabled();
    });

    it('ignores clicks on the label text while buffer zoom is disabled', () => {
        const { resetButton, rangeLabel, lowerHandle, upperHandle } = renderComponent();
        const initialMin = lowerHandle.getAttribute('aria-valuenow');
        const initialMax = upperHandle.getAttribute('aria-valuenow');

        fireEvent.click(rangeLabel);

        expect(lowerHandle).toHaveAttribute('aria-valuenow', initialMin);
        expect(upperHandle).toHaveAttribute('aria-valuenow', initialMax);
        expect(resetButton).toBeDisabled();
    });

    it('restores the full range when the lower handle was narrowed', () => {
        const { resetButton, lowerHandle } = renderComponent();
        const initialMin = lowerHandle.getAttribute('aria-valuenow');

        enableBufferZoom();
        fireEvent.keyDown(lowerHandle, { key: 'ArrowRight' });
        expect(lowerHandle).not.toHaveAttribute('aria-valuenow', initialMin);

        fireEvent.click(resetButton);

        expect(lowerHandle).toHaveAttribute('aria-valuenow', initialMin);
        expect(resetButton).toBeDisabled();
    });

    it('restores the full range when the upper handle was narrowed', () => {
        const { resetButton, upperHandle } = renderComponent();
        const initialMax = upperHandle.getAttribute('aria-valuenow');

        enableBufferZoom();
        fireEvent.keyDown(upperHandle, { key: 'ArrowLeft' });
        expect(upperHandle).not.toHaveAttribute('aria-valuenow', initialMax);
        expect(resetButton).toBeEnabled();

        fireEvent.click(resetButton);

        expect(upperHandle).toHaveAttribute('aria-valuenow', initialMax);
        expect(resetButton).toBeDisabled();
    });
});
