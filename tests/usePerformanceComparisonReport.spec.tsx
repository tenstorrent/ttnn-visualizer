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
import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComparisonReportError, usePerformanceComparisonReport, usePerformanceReport } from '../src/hooks/useAPI';
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
        status: 400,
        statusText: 'Bad Request',
        headers: {},
        config: { headers: new AxiosHeaders() },
    });

const renderWithStore = <T,>(hook: () => T, store: ReturnType<typeof createStore>) =>
    renderHook(hook, {
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={new QueryClient()}>
                <Provider store={store}>{children}</Provider>
            </QueryClientProvider>
        ),
    });

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

        await waitFor(() => expect(result.current.error).toBeInstanceOf(ComparisonReportError));
        expect(result.current.error?.reportName).toBe('report-c');
        expect(result.current.error?.message).toBe(`report-c: ${REFUSAL}`);
        expect(getReportRequests().filter((params) => params.name === 'report-c')).toHaveLength(1);
    });
});
