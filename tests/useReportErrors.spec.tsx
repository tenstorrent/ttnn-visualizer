// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders, HttpStatusCode } from 'axios';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReportErrors } from '../src/hooks/useAPI';
import { activeProfilerReportAtom } from '../src/store/app';
import axiosInstance from '../src/libs/axiosInstance';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
    },
    getOrCreateInstanceId: () => 'test-instance',
}));

const responseError = (status: number) =>
    new AxiosError('Request failed', String(status), undefined, undefined, {
        status,
        statusText: '',
        data: {},
        headers: {},
        config: { headers: new AxiosHeaders() },
    });

const renderReportErrors = () => {
    const store = createStore();
    store.set(activeProfilerReportAtom, { path: 'testPath', reportName: 'test' });

    return renderHook(() => useReportErrors(), {
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={new QueryClient()}>
                <Provider store={store}>{children}</Provider>
            </QueryClientProvider>
        ),
    });
};

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(cleanup);

describe('useReportErrors', () => {
    it('treats a report without an errors table as having no errors', async () => {
        vi.mocked(axiosInstance.get).mockRejectedValue(responseError(HttpStatusCode.UnprocessableEntity));

        const { result } = renderReportErrors();

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual([]);
    });

    it('surfaces any other failure', async () => {
        vi.mocked(axiosInstance.get).mockRejectedValue(responseError(HttpStatusCode.InternalServerError));

        const { result } = renderReportErrors();

        await waitFor(() => expect(result.current.isError).toBe(true));
    });
});
