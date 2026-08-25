// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The cluster descriptor lives beside the memory report, so without one the request can
 * only 404 -- and the navigation rail, which reads this query to decide whether Topology
 * is reachable, is mounted before any report is chosen. The `enabled` gate is what keeps
 * that from firing a guaranteed-404 on every report-less page load.
 *
 * The rail's own spec mocks this hook wholesale, so nothing else covers the gate.
 */

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGetClusterDescription } from '../src/hooks/useAPI';
import { activeProfilerReportAtom } from '../src/store/app';
import axiosInstance from '../src/libs/axiosInstance';
import Endpoints from '../src/definitions/Endpoints';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
    },
    getOrCreateInstanceId: () => 'test-instance',
}));

const ACTIVE_REPORT = { path: 'testPath', reportName: 'test' };

const getClusterRequestCount = () =>
    vi.mocked(axiosInstance.get).mock.calls.filter(([url]) => String(url) === Endpoints.CLUSTER_DESCRIPTOR).length;

// A fresh client per test: `staleTime: Infinity` would otherwise let one test's cached
// descriptor answer the next test's request and hide a fetch that never happened.
const renderGate = (store: ReturnType<typeof createStore>) => {
    const queryClient = new QueryClient();

    return renderHook(() => useGetClusterDescription(), {
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>
                <Provider store={store}>{children}</Provider>
            </QueryClientProvider>
        ),
    });
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(axiosInstance.get).mockResolvedValue({ data: { chips: {} } });
});

// RTL auto-cleanup is off in this project, and these cases assert exact request counts --
// a tree left mounted keeps its query subscription alive and can fire into the next tally.
afterEach(cleanup);

describe('useGetClusterDescription', () => {
    it('does not request the descriptor without an active report', async () => {
        const { result } = renderGate(createStore());

        await waitFor(() => expect(result.current.isLoading).toBe(false));

        expect(getClusterRequestCount()).toBe(0);
        expect(result.current.data).toBeUndefined();
    });

    it('requests the descriptor once a report is active', async () => {
        const store = createStore();

        store.set(activeProfilerReportAtom, ACTIVE_REPORT);

        const { result } = renderGate(store);

        await waitFor(() => expect(getClusterRequestCount()).toBe(1));
        await waitFor(() => expect(result.current.data).toBeDefined());
    });

    it('starts requesting when a report becomes active', async () => {
        const store = createStore();
        const { result } = renderGate(store);

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(getClusterRequestCount()).toBe(0);

        store.set(activeProfilerReportAtom, ACTIVE_REPORT);

        await waitFor(() => expect(getClusterRequestCount()).toBe(1));
    });
});
