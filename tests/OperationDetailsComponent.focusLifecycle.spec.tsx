// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OperationDetailsComponent from '../src/components/operation-details/OperationDetailsComponent';
import { BufferType } from '../src/model/BufferType';
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

function inputTensor() {
    return buildTensor({ id: TENSOR_ID, address: ADDRESS, buffer_type: BufferType.L1, producers: [0] });
}

function inputBuffers() {
    return [buildBufferData({ address: ADDRESS, buffer_type: BufferType.L1, max_size_per_bank: 4096 })];
}

vi.mock('../src/hooks/useAPI', () => ({
    useOperationsList: () => ({
        data: [
            buildOperationDescription({ id: 0, name: 'producer', outputs: [inputTensor()] }),
            buildOperationDescription({ id: OPERATION_ID, name: 'consumer', inputs: [inputTensor()] }),
        ],
    }),
    useGetL1StartMarker: () => 0,
    useGetL1SmallMarker: () => 1_500_000,
    useTensors: () => ({ data: [] }),
    useOperationDetails: (operationId: number) => ({
        operationDetails: {
            data: buildOperationDetailsData({
                id: operationId,
                inputs: [inputTensor()],
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

// The tensor list stays real: its tensor control is the button that starts the focus.
vi.mock('../src/components/operation-details/L1Plots', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/DRAMPlots', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/MemoryPlotRenderer', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/StackTrace', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/DeviceOperationsGraphComponent', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/DeviceOperationsFullRender', () => ({ default: () => null }));
vi.mock('../src/components/OperationArguments', () => ({ default: () => null }));
vi.mock('../src/components/OperationDetailsNavigation', () => ({ default: () => null }));

afterEach(cleanup);

describe('OperationDetailsComponent focus starting and ending on the page (#2042)', () => {
    it('keeps the focus its click sets, and dismisses it on the next click on content', () => {
        // The listener attaches only once the focus exists, so the click that sets it is never judged.
        render(
            <TestProviders>
                <OperationDetailsComponent operationId={OPERATION_ID} />
                <BufferFocusProbe />
            </TestProviders>,
        );
        expect(bufferFocus()).toHaveTextContent('dismissed');

        pressAndRelease(screen.getByRole('button', { name: new RegExp(`Tensor ID: ${TENSOR_ID}`) }));
        expect(bufferFocus()).toHaveTextContent('focused');

        pressAndRelease(screen.getByRole('heading', { name: 'L1 Memory' }));
        expect(bufferFocus()).toHaveTextContent('dismissed');
    });
});
