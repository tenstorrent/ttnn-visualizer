// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Every memory report hook caches under the active report's path and checks each answer
 * against the report's own id (#2375). The two are derived separately in each hook, and a
 * freshly picked remote report is where they differ: its path is the remote path, while
 * the server names it by the folder it synced to. A hook that compared the path's basename,
 * or skipped the check, would cache another report's answer or refuse its own.
 *
 * `useGetClusterTopology` has its own spec, since it reads rank by rank.
 */

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider, QueryKey } from '@tanstack/react-query';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    OPERATIONS_QUERY_KEY,
    REPORT_METADATA_QUERY_KEY,
    useBufferChunks,
    useBuffers,
    useDevices,
    useGetClusterDescription,
    useGetL1SmallMarker,
    useOperationBuffers,
    useOperationDetails,
    useOperationsList,
    useReportErrors,
    useReportMetadata,
    useReportSourceFiles,
    useTensors,
} from '../src/hooks/useAPI';
import { activeProfilerReportAtom } from '../src/store/app';
import axiosInstance from '../src/libs/axiosInstance';
import Endpoints from '../src/definitions/Endpoints';
import { ACTIVE_MEMORY_REPORT_HEADER } from '../src/definitions/ReportHeaders';
import { isReportChangedError } from '../src/functions/memoryReportRequest';
import { BufferType } from '../src/model/BufferType';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
    },
    getOrCreateInstanceId: () => 'test-instance',
}));

vi.mock('../src/functions/createToastNotification', () => ({ default: vi.fn() }));

// Freshly picked: `path` is the remote path, and its basename is not the synced folder's name
const REMOTE_REPORT = { path: '/remote/profiler/reports/bert ', reportName: 'bert', syncedName: 'bert' };
const OPERATION_ID = 1;

// Enough of each endpoint's body for its fetcher to finish; the rest answer an empty list
const BODIES: Record<string, unknown> = {
    [`${Endpoints.OPERATIONS_LIST}/${OPERATION_ID}`]: {
        id: OPERATION_ID,
        stack_trace: '',
        device_operations: [],
        inputs: [],
        outputs: [],
        buffers: [],
    },
    [`${Endpoints.OPERATION_BUFFERS}/${OPERATION_ID}`]: { id: OPERATION_ID, buffers: [] },
    [Endpoints.REPORT_METADATA]: {},
    [Endpoints.DEVICES]: [{ device_id: 0 }],
    [Endpoints.CLUSTER_DESCRIPTOR]: { chips: {} },
    [Endpoints.MESH_DESCRIPTOR]: { chips: {} },
};

const answerAs = (reportId: string) =>
    vi.mocked(axiosInstance.get).mockImplementation((url) =>
        Promise.resolve({
            data: BODIES[String(url)] ?? [],
            headers: { [ACTIVE_MEMORY_REPORT_HEADER]: reportId },
        }),
    );

const HOOKS: [string, () => unknown, QueryKey][] = [
    [
        'useGetL1SmallMarker',
        () => useGetL1SmallMarker(),
        ['fetch-all-buffers', BufferType.L1_SMALL, REMOTE_REPORT.path],
    ],
    [
        'useOperationBuffers',
        () => useOperationBuffers(OPERATION_ID),
        ['get-operation-buffers', OPERATION_ID, REMOTE_REPORT.path],
    ],
    ['useGetClusterDescription', () => useGetClusterDescription(), ['get-cluster-description', REMOTE_REPORT.path]],
    ['useOperationsList', () => useOperationsList(), [OPERATIONS_QUERY_KEY, REMOTE_REPORT.path]],
    ['useReportErrors', () => useReportErrors(), ['get-report-errors', REMOTE_REPORT.path]],
    [
        'useOperationDetails',
        () => useOperationDetails(OPERATION_ID),
        ['get-operation-detail', OPERATION_ID, REMOTE_REPORT.path],
    ],
    ['useReportMetadata', () => useReportMetadata(), [REPORT_METADATA_QUERY_KEY, REMOTE_REPORT.path]],
    ['useReportSourceFiles', () => useReportSourceFiles(), ['get-report-source-files', REMOTE_REPORT.path]],
    [
        'useBufferChunks',
        () => useBufferChunks(OPERATION_ID, 0, BufferType.L1),
        ['get-buffer-chunks', OPERATION_ID, 0, BufferType.L1, REMOTE_REPORT.path],
    ],
    ['useTensors', () => useTensors(), ['get-tensors', REMOTE_REPORT.path, 'all']],
    ['useDevices', () => useDevices(), ['get-devices', REMOTE_REPORT.path]],
    ['useBuffers', () => useBuffers(BufferType.L1), ['fetch-all-buffers', BufferType.L1, REMOTE_REPORT]],
];

const renderForRemoteReport = (useHook: () => unknown) => {
    const store = createStore();
    store.set(activeProfilerReportAtom, REMOTE_REPORT);
    const queryClient = new QueryClient();

    renderHook(useHook, {
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>
                <Provider store={store}>{children}</Provider>
            </QueryClientProvider>
        ),
    });

    return queryClient;
};

beforeEach(() => {
    vi.mocked(axiosInstance.get).mockReset();
});

afterEach(cleanup);

describe.each(HOOKS)('%s for a freshly picked remote report (#2375)', (_name, useHook, queryKey) => {
    it('caches an answer naming its synced folder', async () => {
        answerAs(REMOTE_REPORT.syncedName);
        const queryClient = renderForRemoteReport(useHook);

        await waitFor(() => expect(queryClient.getQueryState(queryKey)?.status).toBe('success'));
    });

    it('throws away an answer naming the basename of its remote path', async () => {
        answerAs('bert ');
        const queryClient = renderForRemoteReport(useHook);

        await waitFor(() => expect(queryClient.getQueryState(queryKey)?.status).toBe('error'));
        expect(isReportChangedError(queryClient.getQueryState(queryKey)?.error)).toBe(true);
        expect(queryClient.getQueryData(queryKey)).toBeUndefined();
    });
});
