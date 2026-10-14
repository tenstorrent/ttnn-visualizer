// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The API refuses a signpost range a report does not hold. These pin what the
 * performance requests send around that: a range chosen on one report is not sent
 * for another, and a comparison report that refuses one is named rather than lost.
 */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider, createStore, useAtomValue } from 'jotai';
import { AxiosError, AxiosHeaders, HttpStatusCode } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePerformanceComparisonReport, usePerformanceReport } from '../src/hooks/useAPI';
import getResponseError from '../src/functions/getResponseError';
import {
    activePerformanceReportAtom,
    activePerformanceReportFolderNameAtom,
    comparisonPerformanceReportListAtom,
    filterBySignpostAtom,
} from '../src/store/app';
import axiosInstance from '../src/libs/axiosInstance';
import Endpoints from '../src/definitions/Endpoints';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
    },
    getOrCreateInstanceId: () => 'test-instance',
}));

const REPORT_A = { path: 'report-a', reportName: 'report-a' };
const REPORT_B = { path: 'report-b', reportName: 'report-b' };
const START = { id: 4, op_code: 'PERF_DECODE' };
const END = { id: 90, op_code: 'PERF_DECODE_END' };
const REFUSAL = "no signpost named 'PERF_DECODE' in this report; it holds 'PERF_PREFILL'";

interface RequestParams {
    name: string;
    start_signpost?: string;
    end_signpost?: string;
}

const getReportRequests = (): RequestParams[] =>
    vi
        .mocked(axiosInstance.get)
        .mock.calls.filter(([url]) => String(url).includes(Endpoints.PERFORMANCE_RESULTS_REPORT))
        .map(([, config]) => (config as { params: RequestParams }).params);

const badRequest = (message: string) =>
    new AxiosError('Request failed with status code 400', AxiosError.ERR_BAD_REQUEST, undefined, undefined, {
        data: { error: message },
        status: HttpStatusCode.BadRequest,
        statusText: 'Bad Request',
        headers: {},
        config: { headers: new AxiosHeaders() },
    });

const renderWithStore = <T,>(hook: () => T, store: ReturnType<typeof createStore>) => {
    // Unobserved queries are dropped at once, so a report switched back to is fetched
    // again rather than answered from the cache, and its request can be asserted.
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });

    return renderHook(hook, {
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>
                <Provider store={store}>{children}</Provider>
            </QueryClientProvider>
        ),
    });
};

const useActiveReport = () => usePerformanceReport(useAtomValue(activePerformanceReportFolderNameAtom));

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(axiosInstance.get).mockResolvedValue({ data: { report: [], stacked_report: [], signposts: [] } });
});

afterEach(cleanup);

describe('the performance report request', () => {
    it('does not send a range chosen on one report for another, and sends it again on switching back', async () => {
        const store = createStore();
        store.set(activePerformanceReportAtom, REPORT_A);
        store.set(filterBySignpostAtom, [START, END]);

        renderWithStore(useActiveReport, store);
        await waitFor(() => expect(getReportRequests().at(-1)?.name).toBe('report-a'));
        expect(getReportRequests().at(-1)).toMatchObject({ start_signpost: START.op_code, end_signpost: END.op_code });

        act(() => store.set(activePerformanceReportAtom, REPORT_B));
        await waitFor(() => expect(getReportRequests().at(-1)?.name).toBe('report-b'));
        expect(getReportRequests().at(-1)?.start_signpost).toBeUndefined();
        expect(getReportRequests().at(-1)?.end_signpost).toBeUndefined();

        act(() => store.set(activePerformanceReportAtom, REPORT_A));
        await waitFor(() => expect(getReportRequests().at(-1)?.name).toBe('report-a'));
        expect(getReportRequests().at(-1)).toMatchObject({ start_signpost: START.op_code, end_signpost: END.op_code });
    });
});

describe('usePerformanceComparisonReport', () => {
    it('names the comparison report that refused the range, without retrying it', async () => {
        vi.mocked(axiosInstance.get).mockImplementation((_url, config) =>
            (config as { params: RequestParams }).params.name === 'report-c'
                ? Promise.reject(badRequest(REFUSAL))
                : Promise.resolve({ data: { report: [], stacked_report: [], signposts: [] } }),
        );
        const store = createStore();
        store.set(activePerformanceReportAtom, REPORT_A);
        store.set(filterBySignpostAtom, [START, END]);
        store.set(comparisonPerformanceReportListAtom, ['report-b', 'report-c']);

        const { result } = renderWithStore(usePerformanceComparisonReport, store);

        await waitFor(() => expect(result.current.error).toBeInstanceOf(AxiosError));
        // Still the response's status, so a call site can branch on it.
        expect(result.current.error?.status).toBe(HttpStatusCode.BadRequest);
        expect(result.current.error?.message).toBe(`report-c: ${REFUSAL}`);
        expect(getResponseError(result.current.error)).toBe(`report-c: ${REFUSAL}`);
        expect(getReportRequests().filter((params) => params.name === 'report-c')).toHaveLength(1);
    });

    it('does not ask again for a refused comparison when the route mounts again', async () => {
        vi.mocked(axiosInstance.get).mockImplementation((_url, config) =>
            (config as { params: RequestParams }).params.name === 'report-c'
                ? Promise.reject(badRequest(REFUSAL))
                : Promise.resolve({ data: { report: [], stacked_report: [], signposts: [] } }),
        );
        const store = createStore();
        store.set(activePerformanceReportAtom, REPORT_A);
        store.set(filterBySignpostAtom, [START, END]);
        store.set(comparisonPerformanceReportListAtom, ['report-c']);
        // One client across both mounts, keeping the failed query as the app does.
        const queryClient = new QueryClient();
        const wrapper = ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>
                <Provider store={store}>{children}</Provider>
            </QueryClientProvider>
        );

        const first = renderHook(usePerformanceComparisonReport, { wrapper });
        await waitFor(() => expect(first.result.current.error).toBeInstanceOf(AxiosError));
        first.unmount();

        const second = renderHook(usePerformanceComparisonReport, { wrapper });

        expect(second.result.current.error).toBeInstanceOf(AxiosError);
        expect(second.result.current.isFetching).toBe(false);
        expect(getReportRequests().filter((params) => params.name === 'report-c')).toHaveLength(1);
    });

    it('names the report when the failure carries no response', async () => {
        vi.mocked(axiosInstance.get).mockImplementation((_url, config) =>
            (config as { params: RequestParams }).params.name === 'report-c'
                ? Promise.reject(new Error('Network Error'))
                : Promise.resolve({ data: { report: [], stacked_report: [], signposts: [] } }),
        );
        const store = createStore();
        store.set(activePerformanceReportAtom, REPORT_A);
        store.set(comparisonPerformanceReportListAtom, ['report-b', 'report-c']);

        const { result } = renderWithStore(usePerformanceComparisonReport, store);

        await waitFor(() => expect(result.current.error).toBeInstanceOf(AxiosError));
        expect(getResponseError(result.current.error)).toBe('report-c: Network Error');
    });
});
