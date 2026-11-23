// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * `fetchOperations` decides which arguments the operations list and operation details view render
 * as a memory config table. `TensorArgument.spec.tsx` builds its arguments the same way by hand, so only this spec
 * sees the parsing come from the real query. #2107
 */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPERATIONS_QUERY_KEY, useOperationsList } from '../src/hooks/useAPI';
import { activeProfilerReportAtom } from '../src/store/app';
import axiosInstance from '../src/libs/axiosInstance';
import Endpoints from '../src/definitions/Endpoints';
import { ACTIVE_MEMORY_REPORT_HEADER } from '../src/definitions/ReportHeaders';
import { isReportChangedError } from '../src/functions/memoryReportRequest';
import parseMemoryConfig from '../src/functions/parseMemoryConfig';
import { OperationDescription } from '../src/model/APIData';
import { makeMemoryConfigArgument, makeOperation, makeTensorRepr } from './helpers/operationDescription';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
    },
    getOrCreateInstanceId: () => 'test-instance',
}));

const ACTIVE_REPORT = { path: 'testPath', reportName: 'test' };
const MEMORY_CONFIG = makeMemoryConfigArgument('L1').value;

// As the backend sends them: no `parsedValue` yet, hence the cast.
const RAW_ARGUMENTS = [
    { name: 'memory_config', value: MEMORY_CONFIG },
    { name: 'memory_config', value: makeTensorRepr(MEMORY_CONFIG) },
    { name: '1', value: '1, -1, 144' },
] as OperationDescription['arguments'];

const renderOperationsList = () => {
    const store = createStore();
    store.set(activeProfilerReportAtom, ACTIVE_REPORT);
    const queryClient = new QueryClient();

    const rendered = renderHook(() => useOperationsList(), {
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>
                <Provider store={store}>{children}</Provider>
            </QueryClientProvider>
        ),
    });

    return { ...rendered, store, queryClient };
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(axiosInstance.get).mockImplementation((url) =>
        Promise.resolve({
            data:
                String(url) === Endpoints.OPERATIONS_LIST
                    ? [makeOperation({ stack_trace: '', arguments: RAW_ARGUMENTS })]
                    : [],
        }),
    );
});

afterEach(cleanup);

describe('useOperationsList', () => {
    it('parses only the arguments whose whole value is a memory config', async () => {
        const { result } = renderOperationsList();

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(result.current.data?.[0].arguments.map(({ parsedValue }) => parsedValue)).toEqual([
            parseMemoryConfig(MEMORY_CONFIG),
            null,
            null,
        ]);
    });

    describe('across a report switch (#2375)', () => {
        const OTHER_REPORT = { path: 'otherPath', reportName: 'other' };
        const operationsFor = (report: typeof ACTIVE_REPORT) => ({
            data: [makeOperation({ name: report.reportName, stack_trace: '' })],
            headers: { [ACTIVE_MEMORY_REPORT_HEADER]: report.path },
        });

        it('throws away operations the server answered for another report rather than caching them', async () => {
            vi.mocked(axiosInstance.get).mockResolvedValue(operationsFor(OTHER_REPORT));
            const { result, queryClient } = renderOperationsList();

            await waitFor(() => expect(result.current.isError).toBe(true));

            expect(isReportChangedError(result.current.error)).toBe(true);
            expect(queryClient.getQueryData([OPERATIONS_QUERY_KEY, ACTIVE_REPORT.path])).toBeUndefined();
        });

        it('reads the first report afresh when it is chosen again after its read was answered for the next', async () => {
            // The first report's read is still in flight when the next one is chosen
            let answerFirstRead: (response: ReturnType<typeof operationsFor>) => void = () => {};
            vi.mocked(axiosInstance.get).mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        answerFirstRead = resolve;
                    }),
            );
            vi.mocked(axiosInstance.get).mockResolvedValue(operationsFor(OTHER_REPORT));
            const { result, store, queryClient } = renderOperationsList();

            act(() => store.set(activeProfilerReportAtom, OTHER_REPORT));
            await waitFor(() => expect(result.current.data?.[0].name).toBe(OTHER_REPORT.reportName));

            // ...and the server, by then holding the next report, answers it for that one
            act(() => answerFirstRead(operationsFor(OTHER_REPORT)));
            await waitFor(() =>
                expect(queryClient.getQueryState([OPERATIONS_QUERY_KEY, ACTIVE_REPORT.path])?.status).toBe('error'),
            );
            expect(queryClient.getQueryData([OPERATIONS_QUERY_KEY, ACTIVE_REPORT.path])).toBeUndefined();

            vi.mocked(axiosInstance.get).mockResolvedValue(operationsFor(ACTIVE_REPORT));
            act(() => store.set(activeProfilerReportAtom, ACTIVE_REPORT));

            await waitFor(() => expect(result.current.data?.[0].name).toBe(ACTIVE_REPORT.reportName));
            expect(axiosInstance.get).toHaveBeenCalledTimes(3);
        });
    });
});
