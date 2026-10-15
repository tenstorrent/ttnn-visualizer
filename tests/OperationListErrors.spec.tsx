// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OperationList from '../src/components/OperationList';
import { TEST_IDS } from '../src/definitions/TestIds';
import { useResetMemoryListStates } from '../src/hooks/useRestoreScrollPosition';
import { OperationDescription, OperationError } from '../src/model/APIData';
import { showOperationErrorsOnlyAtom } from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';

const apiMock = vi.hoisted(() => ({ operations: [] as OperationDescription[] }));

vi.mock('../src/hooks/useAPI', () => ({
    useOperationsList: () => ({ data: apiMock.operations, error: null, isLoading: false }),
    useGetUniqueDeviceOperationsList: () => [],
    useGetDeviceOperationListPerfByOpId: () => new Map(),
    useReportErrors: () => ({ data: [] }),
}));
// jsdom lays nothing out, so the real virtualiser renders no rows; this one
// renders every row it is asked for.
vi.mock('@tanstack/react-virtual', () => ({
    useVirtualizer: ({ count }: { count: number }) => ({
        getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: 0 })),
        getTotalSize: () => count * 39,
        scrollOffset: 0,
        measurementsCache: [],
        measureElement: () => {},
        scrollToIndex: vi.fn(),
    }),
}));
vi.mock('../src/hooks/useOpPerfRowScores', () => ({
    useOpPerfRowScores: () => ({ scoreByOpId: new Map(), isAvailable: false }),
}));

const OUT_OF_MEMORY =
    'Out of Memory: Not enough space to allocate 3276800 B L1 buffer across 4 banks, where each bank needs to store 819200 B, but bank size is only 1382720 B';

const error = (message: string): OperationError => ({
    error_type: 'RuntimeError',
    error_message: message,
    stack_trace: '',
    timestamp: '',
    rank: 0,
});

const operation = (id: number, operationError: OperationError | null = null): OperationDescription =>
    ({
        id,
        name: 'ttnn.conv2d',
        duration: 0,
        error: operationError,
        device_operations: [],
        deviceOperationNameList: [],
        arguments: [],
        stack_trace: '',
    }) as unknown as OperationDescription;

const renderList = (operations: OperationDescription[]) => {
    apiMock.operations = operations;
    render(
        <TestProviders>
            <OperationList />
        </TestProviders>,
    );
};

const errorsOnlyButton = () => screen.getByTestId(TEST_IDS.OPERATION_LIST_ERRORS_ONLY);

afterEach(cleanup);

describe('OperationList errors-only filter', () => {
    it('leaves only operations with a recorded error, and counts against the whole list', () => {
        renderList([operation(1), operation(2, error(OUT_OF_MEMORY)), operation(3, error('Shape mismatch'))]);

        expect(screen.getByText('Showing 3 operations')).toBeInTheDocument();

        fireEvent.click(errorsOnlyButton());

        expect(errorsOnlyButton()).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('Showing 2 of 3 operations')).toBeInTheDocument();
    });

    it('is disabled, and says why, when no operation in the list has an error attached', () => {
        renderList([operation(1), operation(2)]);

        expect(errorsOnlyButton()).toBeDisabled();
        // The report may still record errors attached to no operation.
        expect(errorsOnlyButton()).toHaveAttribute('aria-label', 'No operation in the list has an error attached');
    });

    it('explains an allocation failure above the raw error when its row is expanded', () => {
        renderList([operation(1, error(OUT_OF_MEMORY))]);

        fireEvent.click(document.querySelector('.list-collapsible .collapsible-button')!);

        expect(screen.getByTestId(TEST_IDS.ALLOCATION_FAILURE_DETAILS)).toHaveTextContent('Out of memory');
    });

    it('is cleared with the rest of the list state', () => {
        const { result } = renderHook(
            () => ({ reset: useResetMemoryListStates(), errorsOnly: useAtomValue(showOperationErrorsOnlyAtom) }),
            {
                wrapper: ({ children }) => (
                    <TestProviders initialAtomValues={[[showOperationErrorsOnlyAtom, true]]}>{children}</TestProviders>
                ),
            },
        );

        expect(result.current.errorsOnly).toBe(true);

        act(() => result.current.reset.resetMemoryListStates());

        expect(result.current.errorsOnly).toBe(false);
    });
});
