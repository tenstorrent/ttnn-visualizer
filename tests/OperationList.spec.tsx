// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Pins how the operation list wires in errors: the callout for errors no operation shows,
 * and each operation's own error panes (#2082).
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OperationList from '../src/components/OperationList';
import { TEST_IDS } from '../src/definitions/TestIds';
import { useGetUniqueDeviceOperationsList, useOperationsList, useReportErrors } from '../src/hooks/useAPI';
import { OperationDescription, OperationError, ReportError } from '../src/model/APIData';
import { TestProviders } from './helpers/TestProviders';

vi.mock('../src/hooks/useAPI', () => ({
    useOperationsList: vi.fn(),
    useGetUniqueDeviceOperationsList: vi.fn(),
    useReportErrors: vi.fn(),
}));

vi.mock('../src/hooks/useOpPerfRowScores', () => ({
    useOpPerfRowScores: () => ({ scoreByOpId: new Map(), isAvailable: false }),
}));

vi.mock('../src/components/OperationListPerfData', () => ({ default: () => null }));

vi.mock('../src/hooks/useRestoreScrollPosition', () => ({
    default: () => ({ getListState: () => undefined, updateListState: vi.fn() }),
}));

vi.mock('../src/hooks/useScrollShade', () => ({
    default: () => ({
        hasScrolledFromTop: false,
        hasScrolledToBottom: false,
        updateScrollShade: vi.fn(),
        resetScrollShade: vi.fn(),
        shadeClasses: { top: 'top-shade', bottom: 'bottom-shade' },
    }),
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

const operationError = (overrides: Partial<OperationError> = {}): OperationError => ({
    error_type: 'RuntimeError',
    error_message: 'boom',
    stack_trace: '',
    timestamp: '',
    rank: 0,
    ...overrides,
});

const operation = (id: number, name: string, error: OperationError | null = null): OperationDescription =>
    ({
        id,
        name,
        inputs: [],
        outputs: [],
        stack_trace: '',
        device_operations: [],
        error,
        duration: 1,
        arguments: [],
    }) as unknown as OperationDescription;

const unattachedError: ReportError = {
    ...operationError({ error_type: 'incomplete_operation', error_message: 'never completed' }),
    operation_id: 0,
    operation_name: 'ttnn.conv2d',
    attached: false,
};

const renderList = (operations: OperationDescription[], reportErrors: ReportError[]) => {
    vi.mocked(useOperationsList).mockReturnValue({
        data: operations,
        error: null,
        isLoading: false,
    } as unknown as ReturnType<typeof useOperationsList>);
    vi.mocked(useReportErrors).mockReturnValue({ data: reportErrors } as unknown as ReturnType<typeof useReportErrors>);

    return render(
        <TestProviders>
            <OperationList />
        </TestProviders>,
    );
};

const rowFor = (container: HTMLElement, operationId: number) =>
    container.querySelector<HTMLElement>(`li.list-item-container[data-id='${operationId}']`);

beforeEach(() => {
    vi.mocked(useGetUniqueDeviceOperationsList).mockReturnValue([]);
});

// RTL auto-cleanup is off in this project.
afterEach(cleanup);

describe('OperationList errors', () => {
    it('shows the callout for an error no operation shows', () => {
        renderList([operation(1, 'ttnn.add')], [unattachedError]);

        expect(screen.getByTestId(TEST_IDS.UNATTACHED_ERRORS)).toBeInTheDocument();
    });

    it('shows no callout when every error is on its operation', () => {
        renderList([operation(1, 'ttnn.add')], [{ ...unattachedError, attached: true }]);

        expect(screen.queryByTestId(TEST_IDS.UNATTACHED_ERRORS)).not.toBeInTheDocument();
    });

    it("shows an operation's error message, and its stack trace only when one was recorded", () => {
        const { container } = renderList(
            [
                operation(1, 'ttnn.add', operationError()),
                operation(2, 'ttnn.mul', operationError({ stack_trace: 'frame 0' })),
            ],
            [],
        );

        const withoutTrace = within(rowFor(container, 1)!);
        expect(withoutTrace.getByText('Error Message')).toBeInTheDocument();
        expect(withoutTrace.queryByText('Error Stack Trace')).not.toBeInTheDocument();

        expect(within(rowFor(container, 2)!).getByText('Error Stack Trace')).toBeInTheDocument();
    });
});
