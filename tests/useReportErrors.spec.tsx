// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders, HttpStatusCode } from 'axios';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReportErrors } from '../src/hooks/useAPI';
import { activeProfilerReportAtom } from '../src/store/app';
import axiosInstance from '../src/libs/axiosInstance';
import { ACTIVE_MEMORY_REPORT_HEADER } from '../src/definitions/ReportHeaders';
import { isReportChangedError } from '../src/functions/memoryReportRequest';
import { ReportError } from '../src/model/APIData';

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
    it('returns the errors the report lists', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValue({ data: [] });

        const { result } = renderReportErrors();

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual([]);
    });

    // A report without an errors table answers 200 with no errors, so a 422 is a real
    // rejection, such as a non-zero rank on a legacy report, and must not read as "no errors"
    it.each([HttpStatusCode.UnprocessableEntity, HttpStatusCode.InternalServerError])(
        'surfaces a %i response as an error',
        async (status) => {
            vi.mocked(axiosInstance.get).mockRejectedValue(responseError(status));

            const { result } = renderReportErrors();

            await waitFor(() => expect(result.current.isError).toBe(true));
        },
    );

    describe('across a report switch (#2375)', () => {
        const REPORT_A = { path: 'reportA', reportName: 'A' };
        const REPORT_B = { path: 'reportB', reportName: 'B' };
        const errorsOf = (report: typeof REPORT_A) =>
            [{ error_message: report.reportName }] as unknown as ReportError[];
        const answeredFor = (report: typeof REPORT_A) => ({
            data: errorsOf(report),
            headers: { [ACTIVE_MEMORY_REPORT_HEADER]: report.path },
        });

        const renderFor = (report: typeof REPORT_A) => {
            const store = createStore();
            store.set(activeProfilerReportAtom, report);
            const queryClient = new QueryClient();
            const rendered = renderHook(() => useReportErrors(), {
                wrapper: ({ children }: { children: ReactNode }) => (
                    <QueryClientProvider client={queryClient}>
                        <Provider store={store}>{children}</Provider>
                    </QueryClientProvider>
                ),
            });

            return { ...rendered, store, queryClient };
        };

        // One-off answers a failed case leaves unread must not reach the next
        beforeEach(() => {
            vi.mocked(axiosInstance.get).mockReset();
        });

        // Holds the first request open until the test answers it
        const holdFirstRead = () => {
            let answer: (response: ReturnType<typeof answeredFor>) => void = () => {};
            vi.mocked(axiosInstance.get).mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        answer = resolve;
                    }),
            );

            return (response: ReturnType<typeof answeredFor>) => answer(response);
        };

        it('loads a report picked again while its first read, answered for the report between, is in flight', async () => {
            const answerFirstRead = holdFirstRead();
            vi.mocked(axiosInstance.get).mockResolvedValueOnce(answeredFor(REPORT_B));
            const { result, store } = renderFor(REPORT_A);

            act(() => store.set(activeProfilerReportAtom, REPORT_B));
            await waitFor(() => expect(result.current.data).toEqual(errorsOf(REPORT_B)));

            // A again: its first read is still in flight, so the query joins it
            act(() => store.set(activeProfilerReportAtom, REPORT_A));
            vi.mocked(axiosInstance.get).mockResolvedValueOnce(answeredFor(REPORT_A));
            act(() => answerFirstRead(answeredFor(REPORT_B)));

            await waitFor(() => expect(result.current.data).toEqual(errorsOf(REPORT_A)));
            expect(result.current.isError).toBe(false);
            expect(axiosInstance.get).toHaveBeenCalledTimes(3);
        });

        it('does not retry a read left behind by a switch', async () => {
            const answerFirstRead = holdFirstRead();
            vi.mocked(axiosInstance.get).mockResolvedValue(answeredFor(REPORT_B));
            const { result, store, queryClient } = renderFor(REPORT_A);

            act(() => store.set(activeProfilerReportAtom, REPORT_B));
            await waitFor(() => expect(result.current.data).toEqual(errorsOf(REPORT_B)));
            act(() => answerFirstRead(answeredFor(REPORT_B)));

            await waitFor(() =>
                expect(queryClient.getQueryState(['get-report-errors', REPORT_A.path])?.status).toBe('error'),
            );
            expect(queryClient.getQueryData(['get-report-errors', REPORT_A.path])).toBeUndefined();
            expect(axiosInstance.get).toHaveBeenCalledTimes(2);
        });

        it('retries an answer for another report only once', async () => {
            vi.mocked(axiosInstance.get).mockResolvedValue(answeredFor(REPORT_B));
            const { result } = renderFor(REPORT_A);

            await waitFor(() => expect(result.current.isError).toBe(true));
            expect(isReportChangedError(result.current.error)).toBe(true);
            expect(axiosInstance.get).toHaveBeenCalledTimes(2);
        });
    });
});
