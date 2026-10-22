// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OperationDetailsComponent from '../src/components/operation-details/OperationDetailsComponent';
import SideNavigation from '../src/components/SideNavigation';
import { BufferType } from '../src/model/BufferType';
import { dismissToast } from '../src/functions/createToastNotification';
import { activeToastAtom, selectedAddressAtom, selectedBufferColourAtom, selectedTensorIdAtom } from '../src/store/app';
import { summariseOperationBuffers } from '../src/functions/summariseOperationBuffers';
import { TestProviders } from './helpers/TestProviders';
import type { AtomProviderInitialValues } from './helpers/atomProvider';
import { BufferFocusProbe } from './helpers/BufferFocusProbe';
import { getBufferFocusProbe, pressAndRelease } from './helpers/bufferFocus';
import {
    buildBufferData,
    buildOperationDescription,
    buildOperationDetailsData,
    buildTensor,
} from './helpers/operationDetailsFixtures';

const ADDRESS = 0x4000;
const OPERATION_ID = 1;
const TENSOR_ID = 10;
const COLOUR = '#4e79a7';
const BUFFER_FOCUS: AtomProviderInitialValues = [
    [activeToastAtom, 'buffer-toast'],
    [selectedTensorIdAtom, TENSOR_ID],
    [selectedAddressAtom, ADDRESS],
    [selectedBufferColourAtom, COLOUR],
];

function inputTensor() {
    return buildTensor({ id: TENSOR_ID, address: ADDRESS, buffer_type: BufferType.L1, producers: [0] });
}

function inputBuffers() {
    return [buildBufferData({ address: ADDRESS, buffer_type: BufferType.L1, max_size_per_bank: 4096 })];
}

vi.mock('../src/hooks/useAPI', () => ({
    useGetClusterDescription: () => ({ data: undefined }),
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

vi.mock('../src/functions/createToastNotification', async () => {
    const { toastNotificationModuleMock } = await import('./helpers/mockToastNotification');

    return toastNotificationModuleMock();
});

// The tensor list stays real: its tensor control is the button that starts the focus.
vi.mock('../src/components/operation-details/L1Plots', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/DRAMPlots', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/MemoryPlotRenderer', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/StackTrace', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/DeviceOperationsGraphComponent', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/DeviceOperationsFullRender', () => ({ default: () => null }));
vi.mock('../src/components/OperationArguments', () => ({ default: () => null }));
vi.mock('../src/components/OperationDetailsNavigation', () => ({ default: () => null }));

// The rail sits beside the page, as in `Layout`, so a click on it is one the page has to judge.
const renderPage = (focus: AtomProviderInitialValues = BUFFER_FOCUS) =>
    render(
        <TestProviders initialAtomValues={focus}>
            <SideNavigation />
            <OperationDetailsComponent operationId={OPERATION_ID} />
            <BufferFocusProbe />
        </TestProviders>,
    );

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('OperationDetailsComponent and a focused buffer (#2042)', () => {
    it('keeps the focus its click sets, and dismisses it with its colour and toast on the next click on content', () => {
        // The listener attaches only once the focus exists, so the click that sets it is never judged.
        renderPage([]);
        expect(getBufferFocusProbe()).toHaveTextContent('dismissed');

        pressAndRelease(screen.getByRole('button', { name: new RegExp(`Tensor ID: ${TENSOR_ID}`) }));
        expect(getBufferFocusProbe()).toHaveTextContent('focused');

        pressAndRelease(screen.getByRole('heading', { name: 'L1 Memory' }));
        expect(getBufferFocusProbe()).toHaveTextContent('dismissed');
        expect(dismissToast).toHaveBeenCalledExactlyOnceWith('mock-toast-id');
    });

    it('keeps it through a click on a control, which acts on its own', () => {
        renderPage();

        pressAndRelease(screen.getByRole('button', { name: 'DRAM' }));

        expect(getBufferFocusProbe()).toHaveTextContent('focused');
    });

    it('keeps it through a click on the memory zoom range label, as on any label', () => {
        renderPage();

        pressAndRelease(screen.getByText(/L1 memory zoom range/));

        expect(getBufferFocusProbe()).toHaveTextContent('focused');
    });

    it('dismisses it from blank space in the navigation rail, which the overlay never covered', () => {
        renderPage();

        pressAndRelease(screen.getByRole('navigation', { name: 'Main navigation' }));

        expect(getBufferFocusProbe()).toHaveTextContent('dismissed');
        expect(dismissToast).toHaveBeenCalledExactlyOnceWith('buffer-toast');
    });

    it('keeps it through a click in the panel describing the focused tensor', () => {
        renderPage();

        pressAndRelease(screen.getByRole('heading', { name: `Tensor ${TENSOR_ID}` }));

        expect(getBufferFocusProbe()).toHaveTextContent('focused');
    });
});
