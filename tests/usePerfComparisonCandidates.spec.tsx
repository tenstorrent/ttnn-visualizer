// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The comparison options are read beside the active report, so they are fetched per
 * active report and location, and never under SERVER_MODE, where the route is refused (#2433).
 */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePerfComparisonCandidates } from '../src/hooks/useAPI';
import { activePerformanceReportAtom, performanceReportLocationAtom } from '../src/store/app';
import axiosInstance from '../src/libs/axiosInstance';
import Endpoints from '../src/definitions/Endpoints';
import { ReportLocation } from '../src/definitions/Reports';

const serverConfig = vi.hoisted(() => ({ SERVER_MODE: false }));

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
    },
    getOrCreateInstanceId: () => 'test-instance',
}));

vi.mock('../src/functions/getServerConfig', () => ({
    default: () => serverConfig,
    isFlagEnabled: (value: unknown) => value === true || value === 'true' || value === '1',
}));

const ACTIVE_REPORT = { path: 'active', reportName: 'active' };
const CANDIDATES = [ACTIVE_REPORT, { path: 'sibling', reportName: 'sibling' }];

const candidateRequestCount = () =>
    vi.mocked(axiosInstance.get).mock.calls.filter(([url]) => url === Endpoints.PERFORMANCE_COMPARISON_CANDIDATES)
        .length;

const renderWithStore = (store: ReturnType<typeof createStore>) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return renderHook(() => usePerfComparisonCandidates(), {
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>
                <Provider store={store}>{children}</Provider>
            </QueryClientProvider>
        ),
    });
};

beforeEach(() => {
    vi.clearAllMocks();
    serverConfig.SERVER_MODE = false;
    vi.mocked(axiosInstance.get).mockResolvedValue({ data: CANDIDATES });
});

afterEach(cleanup);

describe('usePerfComparisonCandidates', () => {
    it('lists the reports beside the active performance report', async () => {
        const store = createStore();
        store.set(activePerformanceReportAtom, ACTIVE_REPORT);
        store.set(performanceReportLocationAtom, ReportLocation.LOCAL);

        const { result } = renderWithStore(store);

        await waitFor(() => expect(result.current.data).toEqual(CANDIDATES));
        expect(candidateRequestCount()).toBe(1);
    });

    it('asks again when the active report moves to another location', async () => {
        const store = createStore();
        store.set(activePerformanceReportAtom, ACTIVE_REPORT);
        store.set(performanceReportLocationAtom, ReportLocation.LOCAL);
        const { result } = renderWithStore(store);
        await waitFor(() => expect(result.current.data).toEqual(CANDIDATES));

        // Same folder name, different directory: the local listing must not answer for it.
        act(() => store.set(performanceReportLocationAtom, ReportLocation.REMOTE));

        await waitFor(() => expect(candidateRequestCount()).toBe(2));
    });

    it('asks nothing without an active performance report', () => {
        const { result } = renderWithStore(createStore());

        expect(result.current.fetchStatus).toBe('idle');
        expect(candidateRequestCount()).toBe(0);
    });

    it('asks nothing under SERVER_MODE, where the route is refused', () => {
        serverConfig.SERVER_MODE = true;
        const store = createStore();
        store.set(activePerformanceReportAtom, ACTIVE_REPORT);

        const { result } = renderWithStore(store);

        expect(result.current.fetchStatus).toBe('idle');
        expect(candidateRequestCount()).toBe(0);
    });
});
