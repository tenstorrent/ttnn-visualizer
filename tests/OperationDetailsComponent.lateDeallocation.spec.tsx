// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Classes } from '@blueprintjs/core';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OperationDetailsComponent from '../src/components/operation-details/OperationDetailsComponent';
import { TEST_IDS } from '../src/definitions/TestIds';
import { TensorDeallocationReport } from '../src/model/BufferSummary';
import { showDeallocationReportAtom } from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';
import { buildTensorDeallocationReport } from './helpers/lateDeallocationFixtures';

// The control's own spec proves it stays enabled when `disabled` is omitted; it
// can't see whether this view omits it, which report the view looks up, or
// which wording it passes. Those three decisions live here. #1862
const apiMock = vi.hoisted(() => ({
    lateDeallocationsByOperation: new Map<number, TensorDeallocationReport[]>(),
}));

const buildOperationDetailsData = (id: number) => ({
    id,
    name: 'op',
    inputs: [],
    outputs: [],
    stack_trace: '',
    stack_trace_source_file_id: null,
    operationFileIdentifier: 'op',
    error: null,
    buffers: [],
    buffersSummary: [],
    l1_sizes: [1_500_000],
    device_operations: [],
});

vi.mock('../src/hooks/useAPI', () => ({
    useOperationsList: () => ({ data: [{ id: 0 }, { id: 1 }, { id: 2 }].map((op) => ({ ...op, name: 'op' })) }),
    useGetL1StartMarker: () => 0,
    useGetL1SmallMarker: () => 1_500_000,
    useTensors: () => ({ data: [] }),
    useOperationDetails: (operationId: number) => ({
        operationDetails: { data: buildOperationDetailsData(operationId), isLoading: false, status: 'success' },
    }),
    usePreviousOperationDetails: (operationId: number) => ({
        operationDetails: { data: buildOperationDetailsData(operationId - 1), isLoading: false },
    }),
    useGetTensorDeallocationReportByOperation: () => ({
        lateDeallocationsByOperation: apiMock.lateDeallocationsByOperation,
        nonDeallocatedTensorList: new Map(),
    }),
}));

// The plots, graph and stack trace are covered by their own specs and pull in
// queries of their own; only the controls matter here.
vi.mock('../src/components/operation-details/L1Plots', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/DRAMPlots', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/MemoryPlotRenderer', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/StackTrace', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/DeviceOperationsGraphComponent', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/DeviceOperationsFullRender', () => ({ default: () => null }));
vi.mock('../src/components/operation-details/TensorDetailsList', () => ({ default: () => null }));
vi.mock('../src/components/OperationArguments', () => ({ default: () => null }));
vi.mock('../src/components/OperationDetailsNavigation', () => ({ default: () => null }));

const renderOperation = (operationId: number, showDeallocationReport: boolean) =>
    render(
        <TestProviders initialAtomValues={[[showDeallocationReportAtom, showDeallocationReport]]}>
            <OperationDetailsComponent operationId={operationId} />
        </TestProviders>,
    );

const getSwitch = (): HTMLInputElement =>
    screen.getByLabelText(/mark late tensor deallocations/i, {
        selector: 'input[type="checkbox"]',
    }) as HTMLInputElement;

afterEach(() => {
    cleanup();
    apiMock.lateDeallocationsByOperation = new Map();
});

describe('OperationDetailsComponent late deallocation control (#1862)', () => {
    // `operation?.id || -1` turned id 0 into -1, so the first operation never
    // found its report.
    it("counts operation 0's own report", () => {
        apiMock.lateDeallocationsByOperation = new Map([
            [
                0,
                [
                    buildTensorDeallocationReport({ id: 1, address: 0x1000 }),
                    buildTensorDeallocationReport({ id: 2, address: 0x2000 }),
                ],
            ],
        ]);

        renderOperation(0, false);

        const count = screen.getByTestId(TEST_IDS.LATE_DEALLOC_COUNT);
        expect(count).toHaveTextContent('2');
        expect(count).toHaveClass(Classes.INTENT_WARNING);
    });

    it('words the count as tensors held at this operation', () => {
        apiMock.lateDeallocationsByOperation = new Map([[1, [buildTensorDeallocationReport()]]]);

        renderOperation(1, false);

        expect(screen.getByTestId(TEST_IDS.LATE_DEALLOC_COUNT)).toHaveAttribute(
            'aria-label',
            '1 tensor held past its last use at this operation',
        );
    });

    // The switch is global: disabling or unchecking it on a clean operation would
    // misreport its state for every other operation.
    it('keeps the switch enabled and on for a clean operation while the switch is on', () => {
        apiMock.lateDeallocationsByOperation = new Map([[1, [buildTensorDeallocationReport()]]]);

        renderOperation(2, true);

        const count = screen.getByTestId(TEST_IDS.LATE_DEALLOC_COUNT);
        expect(count).toHaveTextContent('0');
        expect(count).not.toHaveClass(Classes.INTENT_WARNING);
        expect(getSwitch()).not.toBeDisabled();
        expect(getSwitch()).toBeChecked();
    });
});
