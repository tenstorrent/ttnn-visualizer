// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The report map is empty while the buffers load, after they fail and for
 * operations outside the selected range — the same as for a clean report. The
 * hook's status and range are what let Operation Details tell those apart, and
 * the component's own spec mocks this hook wholesale, so only this one sees them
 * come from the real queries. #1862
 */

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGetTensorDeallocationReportByOperation } from '../src/hooks/useAPI';
import { activeProfilerReportAtom, selectedOperationRangeAtom } from '../src/store/app';
import axiosInstance from '../src/libs/axiosInstance';
import Endpoints from '../src/definitions/Endpoints';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
    },
    getOrCreateInstanceId: () => 'test-instance',
}));

const ACTIVE_REPORT = { path: 'testPath', reportName: 'test' };

const mockBuffersResponse = (buffersResponse: () => Promise<unknown>) =>
    vi
        .mocked(axiosInstance.get)
        .mockImplementation((url) =>
            String(url) === Endpoints.OPERATION_BUFFERS ? buffersResponse() : Promise.resolve({ data: [] }),
        );

// A fresh client per test: `staleTime: Infinity` would otherwise let one test's
// buffers answer the next test's request.
const renderReport = (store: ReturnType<typeof createStore>) => {
    const queryClient = new QueryClient();

    return renderHook(() => useGetTensorDeallocationReportByOperation(), {
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>
                <Provider store={store}>{children}</Provider>
            </QueryClientProvider>
        ),
    });
};

const activeStore = () => {
    const store = createStore();
    store.set(activeProfilerReportAtom, ACTIVE_REPORT);
    return store;
};

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(cleanup);

describe('useGetTensorDeallocationReportByOperation', () => {
    it('is pending, with an empty report, until the buffers arrive', async () => {
        let resolveBuffers: (value: unknown) => void = () => {};
        mockBuffersResponse(
            () =>
                new Promise((resolve) => {
                    resolveBuffers = resolve;
                }),
        );

        const { result } = renderReport(activeStore());

        expect(result.current.status).toBe('pending');
        expect(result.current.lateDeallocationsByOperation.size).toBe(0);

        resolveBuffers({ data: [] });

        await waitFor(() => expect(result.current.status).toBe('success'));
    });

    // The "too large to render" path rejects too, and must not settle as a clean report.
    it('reports an error when the buffers fail', async () => {
        mockBuffersResponse(() => Promise.reject(new Error('buffers failed')));

        const { result } = renderReport(activeStore());

        await waitFor(() => expect(result.current.status).toBe('error'));
        expect(result.current.lateDeallocationsByOperation.size).toBe(0);
    });

    it('reports the operation range the buffers were filtered to', async () => {
        mockBuffersResponse(() => Promise.resolve({ data: [] }));
        const store = activeStore();
        store.set(selectedOperationRangeAtom, [2, 5]);

        const { result } = renderReport(store);

        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(result.current.operationRange).toEqual([2, 5]);
    });
});
