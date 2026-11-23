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

const ACTIVE_REPORT = { path: 'memory-run', reportName: 'memory-run' };
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

/** Serves two ranks of this report, then says there is no third; `descriptor` and `mesh` override rank 1. */
const serveRanks = ({ descriptor, mesh }: { descriptor?: Answer; mesh?: Answer } = {}) =>
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
            return Promise.reject(notFoundFor(ACTIVE_REPORT.path));
        }

        return Promise.resolve(answeredFor(ACTIVE_REPORT.path, rankedDescriptor(rank)));
    });

const renderTopology = () => {
    const store = createStore();
    store.set(activeProfilerReportAtom, ACTIVE_REPORT);
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
