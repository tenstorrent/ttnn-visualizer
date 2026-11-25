// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * A multi-host topology is read rank by rank until the server says there are no more: a 400
 * or 404 for the next rank ends the probe. An answer for another report is not that signal
 * (#2375). It has no status, so it fails the whole topology rather than cutting it short at
 * the rank it arrived on, which would cache a partial topology under this report.
 */

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders, AxiosRequestConfig, HttpStatusCode, InternalAxiosRequestConfig } from 'axios';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGetClusterTopology } from '../src/hooks/useAPI';
import { activeProfilerReportAtom } from '../src/store/app';
import axiosInstance from '../src/libs/axiosInstance';
import Endpoints from '../src/definitions/Endpoints';
import { ACTIVE_MEMORY_REPORT_HEADER } from '../src/definitions/ReportHeaders';
import { isReportChangedError } from '../src/functions/memoryReportRequest';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
    },
    getOrCreateInstanceId: () => 'test-instance',
}));

type ActiveReport = { path: string; reportName: string; syncedName?: string };

const ACTIVE_REPORT: ActiveReport = { path: 'memory-run', reportName: 'memory-run' };
// Freshly picked: `path` is the remote path, and its basename is not the synced folder's name
const REMOTE_REPORT: ActiveReport = {
    path: '/remote/profiler/reports/memory-run',
    reportName: 'memory-run',
    syncedName: 'memory-run-synced',
};
const OTHER_REPORT_ID = 'other-run';

/** A rank's descriptor, linked to the other rank so rank 0 reads as multi-host. */
const rankedDescriptor = (rank: number) => ({
    arch: { 0: 'wormhole_b0' },
    chips: {},
    ethernet_connections: [],
    chips_with_mmio: [{ 0: 0 }],
    chip_unique_ids: { 0: String(rank * 100) },
    ethernet_connections_to_remote_devices: [
        [
            { chip: 0, chan: 0 },
            { remote_chip_id: String((1 - rank) * 100), chan: 0 },
        ],
    ],
});

const answeredFor = (reportId: string, data: unknown) => ({
    data,
    headers: { [ACTIVE_MEMORY_REPORT_HEADER]: reportId },
});

const notFoundFor = (reportId: string) =>
    new AxiosError(
        'Request failed',
        AxiosError.ERR_BAD_REQUEST,
        { headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
        undefined,
        {
            data: {},
            status: HttpStatusCode.NotFound,
            statusText: '',
            headers: { [ACTIVE_MEMORY_REPORT_HEADER]: reportId },
            config: { headers: new AxiosHeaders() },
        },
    );

type Answer = () => Promise<unknown>;

/**
 * Serves two ranks of the report the server names `reportId`, then says there is no third;
 * `descriptor` and `mesh` override rank 1.
 */
const serveRanks = (
    { descriptor, mesh }: { descriptor?: Answer; mesh?: Answer } = {},
    reportId: string = ACTIVE_REPORT.path,
) =>
    vi.mocked(axiosInstance.get).mockImplementation((url, config?: AxiosRequestConfig) => {
        const rank = Number(config?.params?.rank ?? 0);
        const isMesh = String(url) === Endpoints.MESH_DESCRIPTOR;

        if (rank === 1 && isMesh && mesh) {
            return mesh();
        }
        if (rank === 1 && !isMesh && descriptor) {
            return descriptor();
        }
        if (rank > 1 || isMesh) {
            return Promise.reject(notFoundFor(reportId));
        }

        return Promise.resolve(answeredFor(reportId, rankedDescriptor(rank)));
    });

const renderTopology = (report: ActiveReport = ACTIVE_REPORT) => {
    const store = createStore();
    store.set(activeProfilerReportAtom, report);
    const queryClient = new QueryClient();

    return renderHook(() => useGetClusterTopology(), {
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>
                <Provider store={store}>{children}</Provider>
            </QueryClientProvider>
        ),
    });
};

beforeEach(() => {
    vi.mocked(axiosInstance.get).mockReset();
    // Each rank's optional mesh descriptor is missing, which is only logged
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useGetClusterTopology', () => {
    it('reads every rank until the server says there are no more', async () => {
        serveRanks();
        const { result } = renderTopology();

        await waitFor(() => expect(result.current.isSuccess && result.current.data !== null).toBe(true));
        expect(result.current.data?.hosts).toHaveLength(2);
    });

    // The server names a synced remote report by its folder, not by the remote path's basename
    it('reads a freshly picked remote report under its synced name', async () => {
        serveRanks({}, REMOTE_REPORT.syncedName);
        const { result } = renderTopology(REMOTE_REPORT);

        await waitFor(() => expect(result.current.isSuccess && result.current.data !== null).toBe(true));
        expect(result.current.data?.hosts).toHaveLength(2);
    });

    it("stops at a rank this report doesn't have", async () => {
        serveRanks({ descriptor: () => Promise.reject(notFoundFor(ACTIVE_REPORT.path)) });
        const { result } = renderTopology();

        await waitFor(() => expect(result.current.isSuccess && result.current.data !== null).toBe(true));
        expect(result.current.data?.hosts).toHaveLength(1);
    });

    it.each([
        [
            'descriptor answers',
            { descriptor: () => Promise.resolve(answeredFor(OTHER_REPORT_ID, rankedDescriptor(1))) },
        ],
        ['descriptor fails', { descriptor: () => Promise.reject(notFoundFor(OTHER_REPORT_ID)) }],
        ['mesh answers', { mesh: () => Promise.resolve(answeredFor(OTHER_REPORT_ID, { chips: {} })) }],
    ])("fails rather than cutting the topology short when a rank's %s for another report", async (_case, answers) => {
        serveRanks(answers);
        const { result } = renderTopology();

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(isReportChangedError(result.current.error)).toBe(true);
        expect(result.current.data).toBeNull();
    });
});
