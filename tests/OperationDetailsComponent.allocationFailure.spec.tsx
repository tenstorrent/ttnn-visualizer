// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OperationDetailsComponent from '../src/components/operation-details/OperationDetailsComponent';
import { TEST_IDS } from '../src/definitions/TestIds';
import { Node, NodeType, OperationError } from '../src/model/APIData';
import { TestProviders } from './helpers/TestProviders';
import { buildOperationDetailsData } from './helpers/operationDetailsFixtures';

const apiMock = vi.hoisted(() => ({
    error: null as OperationError | null,
    deviceOperations: [] as Node[],
    isPreviousLoading: false,
}));

vi.mock('../src/hooks/useAPI', () => ({
    useOperationsList: () => ({ data: [{ id: 0 }, { id: 1 }].map((op) => ({ ...op, name: 'op' })) }),
    useGetL1StartMarker: () => 0,
    useGetL1SmallMarker: () => 1_500_000,
    useTensors: () => ({ data: [] }),
    useOperationDetails: (operationId: number) => ({
        operationDetails: {
            data: buildOperationDetailsData({
                id: operationId,
                name: 'ttnn.conv2d',
                error: apiMock.error,
                device_operations: apiMock.deviceOperations,
            }),
            isLoading: false,
            status: 'success',
        },
    }),
    usePreviousOperationDetails: (operationId: number) => ({
        operationDetails: {
            data: apiMock.isPreviousLoading ? undefined : buildOperationDetailsData({ id: operationId - 1 }),
            isLoading: apiMock.isPreviousLoading,
        },
    }),
    useGetTensorDeallocationReportByOperation: () => ({
        lateDeallocationsByOperation: new Map(),
        nonDeallocatedTensorList: new Map(),
        status: 'success',
        operationRange: null,
    }),
}));

// Everything else on the page has its own spec; only the callout matters here.
vi.mock('../src/components/operation-details/L1Plots', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/DRAMPlots', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/MemoryPlotRenderer', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/StackTrace', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/DeviceOperationsGraphComponent', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/DeviceOperationsFullRender', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/TensorDetailsList', () => ({ default: () => null }));
vi.mock('../src/components/OperationArguments', () => ({ default: () => null }));
vi.mock('../src/components/OperationDetailsNavigation', () => ({ default: () => null }));

const OUT_OF_MEMORY =
    'Out of Memory: Not enough space to allocate 3276800 B L1 buffer across 4 banks, where each bank needs to store 819200 B, but bank size is 1382720 B (allocated: 1000000 B, free: 382720 B, largest free block: 300000 B)';

const error = (message: string): OperationError => ({
    error_type: 'RuntimeError',
    error_message: message,
    stack_trace: '',
    timestamp: '',
    rank: 0,
});

const node = (nodeType: NodeType, name: string): Node =>
    ({
        id: 0,
        node_type: nodeType,
        params: { name },
        connections: [],
        inputs: [],
        outputs: [],
        stacking_level: 0,
    }) as unknown as Node;

const renderOperation = () =>
    render(
        <TestProviders>
            <OperationDetailsComponent operationId={1} />
        </TestProviders>,
    );

afterEach(() => {
    cleanup();
    apiMock.error = null;
    apiMock.deviceOperations = [];
    apiMock.isPreviousLoading = false;
});

describe('OperationDetailsComponent allocation failure callout', () => {
    it('explains the failure and names the device op it happened in', () => {
        apiMock.error = error(OUT_OF_MEMORY);
        apiMock.deviceOperations = [node(NodeType.function_start, 'Conv2dDeviceOperation')];

        renderOperation();

        const callout = screen.getByTestId(TEST_IDS.OPERATION_ALLOCATION_FAILURE_CALLOUT);
        expect(callout).toHaveTextContent('Short by 426 KiB per bank');
        expect(callout).toHaveTextContent('Failed in Conv2dDeviceOperation');
    });

    it('shows while the rest of the page is still loading', () => {
        apiMock.error = error(OUT_OF_MEMORY);
        apiMock.isPreviousLoading = true;

        renderOperation();

        expect(screen.getByTestId(TEST_IDS.OPERATION_ALLOCATION_FAILURE_CALLOUT)).toBeInTheDocument();
    });

    it('is absent for an error that is not an allocation failure, or none', () => {
        apiMock.error = error('Shape mismatch');
        renderOperation();
        expect(screen.queryByTestId(TEST_IDS.OPERATION_ALLOCATION_FAILURE_CALLOUT)).toBeNull();

        cleanup();
        apiMock.error = null;
        renderOperation();
        expect(screen.queryByTestId(TEST_IDS.OPERATION_ALLOCATION_FAILURE_CALLOUT)).toBeNull();
    });
});
