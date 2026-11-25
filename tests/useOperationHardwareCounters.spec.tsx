// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOperationHardwareCounters } from '../src/hooks/useAPI';
import { activePerformanceReportAtom } from '../src/store/app';
import axiosInstance from '../src/libs/axiosInstance';
import Endpoints from '../src/definitions/Endpoints';
import { ReportFolder } from '../src/definitions/Reports';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
    },
    getOrCreateInstanceId: () => 'test-instance',
}));

const REPORT: ReportFolder = { path: '/reports/report-a', reportName: 'report-a' };
const PERF_ID = 2;

const renderCounters = (perfId: number | null, report: ReportFolder | null = REPORT) => {
    const store = createStore();
    store.set(activePerformanceReportAtom, report);
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });

    return renderHook(() => useOperationHardwareCounters(perfId), {
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>
                <Provider store={store}>{children}</Provider>
            </QueryClientProvider>
        ),
    });
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(axiosInstance.get).mockResolvedValue({ data: { perf_id: PERF_ID } });
});

afterEach(cleanup);

describe('useOperationHardwareCounters', () => {
    it("asks for the row of the report the table shows, by that report's folder", async () => {
        const { result } = renderCounters(PERF_ID);

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(axiosInstance.get).toHaveBeenCalledExactlyOnceWith(`${Endpoints.PERFORMANCE_COUNTERS}/${PERF_ID}`, {
            params: { name: 'report-a' },
        });
    });

    it.each([
        { reason: 'a row without an id', perfId: null, report: REPORT },
        { reason: 'no active performance report', perfId: PERF_ID, report: null },
    ])('asks for nothing for $reason', ({ perfId, report }) => {
        const { result } = renderCounters(perfId, report);

        expect(result.current.fetchStatus).toBe('idle');
        expect(axiosInstance.get).not.toHaveBeenCalled();
    });
});
