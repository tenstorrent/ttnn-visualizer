// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Choosing a memory or performance report only marks its load as pending. The recorder
 * records `report_loaded` or `report_load_failed` once that report's data settles, so a
 * report the app then cannot read is counted as a failure rather than a load (#2343).
 *
 * The footer's real `Range` is mounted ahead of the recorder, as in `Layout`: it unloads a
 * performance report that fails in the same commit the failure arrives, and the failure
 * must still be recorded against it.
 */

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode, StrictMode } from 'react';
import { AxiosError, AxiosHeaders, HttpStatusCode } from 'axios';
import { Provider, atom, createStore, useAtomValue } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Range from '../src/components/RangeSlider';
import ReportLoadRecorder from '../src/components/ReportLoadRecorder';
import { ReportKind, ReportLoadFailureReason, ReportSource } from '../src/definitions/EventLogEvent';
import { TARGET_DB_VERSION_MAX } from '../src/definitions/Versions';
import { useMarkReportLoadPending } from '../src/hooks/useReportLoadSettlement';
import { OPERATIONS_QUERY_KEY, REPORT_METADATA_QUERY_KEY } from '../src/hooks/useAPI';
import {
    SettledReportKind,
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    filterBySignpostAtom,
    pendingReportLoadsAtom,
} from '../src/store/app';
import { PendingReportLoadsProbe } from './helpers/PendingReportLoadsProbe';
import { getProbedPendingReportLoads } from './helpers/pendingReportLoads';
import { TestProviders } from './helpers/TestProviders';

type QueryResult = { data: unknown; error: AxiosError | null };

const { recordReportLoaded, recordReportLoadFailed, queries } = vi.hoisted(() => ({
    recordReportLoaded: vi.fn(),
    recordReportLoadFailed: vi.fn(),
    // Keyed by the report each query is for; a missing key is a request still in flight
    queries: {
        metadata: new Map<string, () => QueryResult>(),
        operations: new Map<string, () => QueryResult>(),
        performance: new Map<string, () => QueryResult>(),
    },
}));

const IN_FLIGHT: QueryResult = { data: undefined, error: null };
// Bumped when a response "arrives", so every query subscriber re-renders, as React Query's would
const responsesAtom = atom(0);

vi.mock('../src/hooks/useAPI', async (importOriginal) => ({
    // The real cache reset and its keys, for the marker's own cases
    ...(await importOriginal<typeof import('../src/hooks/useAPI')>()),
    useReportMetadata: () => {
        useAtomValue(responsesAtom);
        const path = useAtomValue(activeProfilerReportAtom)?.path;

        return (path && queries.metadata.get(path)?.()) || IN_FLIGHT;
    },
    usePerformanceReport: (name: string | null) => {
        useAtomValue(responsesAtom);

        return (name && queries.performance.get(name)?.()) || IN_FLIGHT;
    },
    // The rest of `Range`'s data, settled empty
    useGetClusterDescription: () => ({ error: null }),
    useGetDeviceOperationListPerf: () => [],
    useOpToPerfIdFiltered: () => [],
    useOperationListRange: () => null,
    useOperationsList: () => {
        useAtomValue(responsesAtom);
        const path = useAtomValue(activeProfilerReportAtom)?.path;

        return (path && queries.operations.get(path)?.()) || IN_FLIGHT;
    },
    usePerformanceRange: () => null,
}));

vi.mock('../src/functions/reportLoadEvents', async (importOriginal) => {
    const { reportLoadEventsSpiesMock } = await import('./helpers/mockReportLoadEvents');

    return reportLoadEventsSpiesMock(importOriginal, recordReportLoaded, recordReportLoadFailed);
});

vi.mock('../src/functions/createToastNotification', () => ({ default: vi.fn() }));

const REPORT_A = { path: 'report-a', reportName: 'report-a' };
const REPORT_B = { path: 'report-b', reportName: 'report-b' };
const SIGNPOST_START = { id: 4, op_code: 'PERF_DECODE' };
const SIGNPOST_END = { id: 90, op_code: 'PERF_DECODE_END' };

const failedWith = (status: HttpStatusCode, message = 'failed') =>
    new AxiosError(message, AxiosError.ERR_BAD_REQUEST, undefined, undefined, {
        data: { error: message },
        status,
        statusText: '',
        headers: {},
        config: { headers: new AxiosHeaders() },
    });

const settledMetadata = (major: number) => () => ({ data: { version: { major, minor: 0, patch: 0 } }, error: null });
const failed = (status: HttpStatusCode) => () => ({ data: undefined, error: failedWith(status) });
const settledRows = () => ({ data: { report: [] }, error: null });
const settledOperations = () => ({ data: [], error: null });

let store: ReturnType<typeof createStore>;

const markPending = (kind: SettledReportKind, path: string, source: ReportSource) =>
    store.set(pendingReportLoadsAtom, (pending) => ({ ...pending, [kind]: { path, source } }));

const recorderTree = () => (
    <TestProviders>
        <Provider store={store}>
            {/* Ahead of the recorder, as the footer is in Layout */}
            <Range />
            <ReportLoadRecorder />
            <PendingReportLoadsProbe />
        </Provider>
    </TestProviders>
);

const renderRecorder = () => render(recorderTree());

/** Activates a report and marks it pending in one batch, as the selectors do. */
const choose = (kind: SettledReportKind, report: typeof REPORT_A, source = ReportSource.LOCAL_TT_METAL) =>
    act(() => {
        store.set(kind === ReportKind.PROFILER ? activeProfilerReportAtom : activePerformanceReportAtom, report);
        markPending(kind, report.path, source);
    });

/** Settles queries that were in flight, as responses arriving would. */
const settle = (map: Map<string, () => QueryResult>, path: string, result: () => QueryResult) =>
    act(() => {
        map.set(path, result);
        store.set(responsesAtom, (responses) => responses + 1);
    });

/** Settles a memory report's two reads: its metadata, then its operations. */
const settleMemory = (path: string, metadata: () => QueryResult, operations: () => QueryResult = settledOperations) => {
    settle(queries.metadata, path, metadata);
    settle(queries.operations, path, operations);
};

beforeEach(() => {
    vi.clearAllMocks();
    store = createStore();
    queries.metadata.clear();
    queries.operations.clear();
    queries.performance.clear();
});

afterEach(cleanup);

describe('a chosen memory report', () => {
    it('records a load once its operations and supported metadata arrive', () => {
        renderRecorder();
        choose(ReportKind.PROFILER, REPORT_A, ReportSource.REMOTE_SYNC);
        settle(queries.metadata, REPORT_A.path, settledMetadata(TARGET_DB_VERSION_MAX));

        // Metadata alone does not show the report can be read
        expect(recordReportLoaded).not.toHaveBeenCalled();

        settle(queries.operations, REPORT_A.path, settledOperations);

        expect(recordReportLoaded).toHaveBeenCalledTimes(1);
        expect(recordReportLoaded).toHaveBeenCalledWith(ReportKind.PROFILER, ReportSource.REMOTE_SYNC);
        expect(recordReportLoadFailed).not.toHaveBeenCalled();
        expect(getProbedPendingReportLoads()).toEqual({});
    });

    it('waits for supported metadata when the operations arrive first', () => {
        renderRecorder();
        choose(ReportKind.PROFILER, REPORT_A);
        settle(queries.operations, REPORT_A.path, settledOperations);

        expect(recordReportLoaded).not.toHaveBeenCalled();

        settle(queries.metadata, REPORT_A.path, settledMetadata(TARGET_DB_VERSION_MAX));

        expect(recordReportLoaded).toHaveBeenCalledTimes(1);
    });

    it('records an unsupported version as a failure as soon as the metadata arrives', () => {
        renderRecorder();
        choose(ReportKind.PROFILER, REPORT_A);
        settle(queries.metadata, REPORT_A.path, settledMetadata(TARGET_DB_VERSION_MAX + 1));

        expect(recordReportLoadFailed).toHaveBeenCalledTimes(1);
        expect(recordReportLoadFailed).toHaveBeenCalledWith(
            ReportKind.PROFILER,
            ReportLoadFailureReason.UNSUPPORTED_VERSION,
        );
        expect(recordReportLoaded).not.toHaveBeenCalled();
    });

    it('records a legacy report without the metadata table as a load once its operations arrive', () => {
        renderRecorder();
        choose(ReportKind.PROFILER, REPORT_A);
        settleMemory(REPORT_A.path, failed(HttpStatusCode.UnprocessableEntity));

        expect(recordReportLoaded).toHaveBeenCalledWith(ReportKind.PROFILER, ReportSource.LOCAL_TT_METAL);
        expect(recordReportLoadFailed).not.toHaveBeenCalled();
    });

    it('records a report whose operations cannot be read, although its metadata can', () => {
        renderRecorder();
        choose(ReportKind.PROFILER, REPORT_A);
        settleMemory(REPORT_A.path, settledMetadata(TARGET_DB_VERSION_MAX), failed(HttpStatusCode.InternalServerError));

        expect(recordReportLoadFailed).toHaveBeenCalledTimes(1);
        expect(recordReportLoadFailed).toHaveBeenCalledWith(ReportKind.PROFILER, ReportLoadFailureReason.OTHER);
        expect(recordReportLoaded).not.toHaveBeenCalled();
    });

    it('records an unsupported version although its operations failed before the metadata arrived', () => {
        renderRecorder();
        choose(ReportKind.PROFILER, REPORT_A);
        settle(queries.operations, REPORT_A.path, failed(HttpStatusCode.InternalServerError));

        // The version decides, so nothing is recorded until it arrives
        expect(recordReportLoadFailed).not.toHaveBeenCalled();
        expect(getProbedPendingReportLoads()).toEqual({
            [ReportKind.PROFILER]: { path: REPORT_A.path, source: ReportSource.LOCAL_TT_METAL },
        });

        settle(queries.metadata, REPORT_A.path, settledMetadata(TARGET_DB_VERSION_MAX + 1));

        expect(recordReportLoadFailed).toHaveBeenCalledTimes(1);
        expect(recordReportLoadFailed).toHaveBeenCalledWith(
            ReportKind.PROFILER,
            ReportLoadFailureReason.UNSUPPORTED_VERSION,
        );
        expect(getProbedPendingReportLoads()).toEqual({});
    });

    it('classifies any other metadata failure', () => {
        renderRecorder();
        choose(ReportKind.PROFILER, REPORT_A);
        settleMemory(REPORT_A.path, failed(HttpStatusCode.NotFound));

        expect(recordReportLoadFailed).toHaveBeenCalledWith(ReportKind.PROFILER, ReportLoadFailureReason.MISSING_FILE);
        expect(recordReportLoaded).not.toHaveBeenCalled();
    });
});

describe('a chosen performance report', () => {
    it('records a load once its rows arrive', () => {
        renderRecorder();
        choose(ReportKind.PERFORMANCE, REPORT_A, ReportSource.UPLOAD);
        settle(queries.performance, REPORT_A.path, settledRows);

        expect(recordReportLoaded).toHaveBeenCalledTimes(1);
        expect(recordReportLoaded).toHaveBeenCalledWith(ReportKind.PERFORMANCE, ReportSource.UPLOAD);
    });

    it('records a report the server cannot parse, although Range unloads it in the same commit', () => {
        renderRecorder();
        choose(ReportKind.PERFORMANCE, REPORT_A);
        settle(queries.performance, REPORT_A.path, failed(HttpStatusCode.UnprocessableEntity));

        expect(store.get(activePerformanceReportAtom)).toBeNull();
        expect(recordReportLoadFailed).toHaveBeenCalledTimes(1);
        expect(recordReportLoadFailed).toHaveBeenCalledWith(
            ReportKind.PERFORMANCE,
            ReportLoadFailureReason.PARSE_ERROR,
        );
        expect(recordReportLoaded).not.toHaveBeenCalled();
        expect(getProbedPendingReportLoads()).toEqual({});
    });

    it('classifies any other failure', () => {
        renderRecorder();
        choose(ReportKind.PERFORMANCE, REPORT_A);
        settle(queries.performance, REPORT_A.path, failed(HttpStatusCode.NotFound));

        expect(recordReportLoadFailed).toHaveBeenCalledTimes(1);
        expect(recordReportLoadFailed).toHaveBeenCalledWith(
            ReportKind.PERFORMANCE,
            ReportLoadFailureReason.MISSING_FILE,
        );
        expect(recordReportLoaded).not.toHaveBeenCalled();
        expect(getProbedPendingReportLoads()).toEqual({});
    });

    it('waits out a refused signpost range and records the refetch', () => {
        renderRecorder();
        act(() => store.set(activePerformanceReportAtom, REPORT_A));
        act(() => store.set(filterBySignpostAtom, [SIGNPOST_START, SIGNPOST_END]));
        // As the real query does: the range is part of its key, so without one the API answers
        queries.performance.set(REPORT_A.path, () =>
            store.get(filterBySignpostAtom).some(Boolean)
                ? { data: undefined, error: failedWith(HttpStatusCode.BadRequest) }
                : settledRows(),
        );
        act(() => {
            markPending(ReportKind.PERFORMANCE, REPORT_A.path, ReportSource.LOCAL_TT_METAL);
            store.set(responsesAtom, (responses) => responses + 1);
        });

        expect(store.get(filterBySignpostAtom).some(Boolean)).toBe(false);
        expect(recordReportLoadFailed).not.toHaveBeenCalled();
        expect(recordReportLoaded).toHaveBeenCalledTimes(1);
        expect(recordReportLoaded).toHaveBeenCalledWith(ReportKind.PERFORMANCE, ReportSource.LOCAL_TT_METAL);
    });
});

describe('what records nothing', () => {
    it('a choice replaced before its data arrives, for either report', () => {
        renderRecorder();
        choose(ReportKind.PROFILER, REPORT_A);
        choose(ReportKind.PERFORMANCE, REPORT_A);
        act(() => {
            store.set(activeProfilerReportAtom, REPORT_B);
            store.set(activePerformanceReportAtom, REPORT_B);
        });
        queries.metadata.set(REPORT_A.path, settledMetadata(TARGET_DB_VERSION_MAX));
        queries.operations.set(REPORT_A.path, settledOperations);
        queries.performance.set(REPORT_A.path, settledRows);
        settleMemory(REPORT_B.path, settledMetadata(TARGET_DB_VERSION_MAX));
        settle(queries.performance, REPORT_B.path, settledRows);

        expect(recordReportLoaded).not.toHaveBeenCalled();
        expect(recordReportLoadFailed).not.toHaveBeenCalled();
        expect(getProbedPendingReportLoads()).toEqual({});
    });

    it('a choice cleared before its data arrives, as deleting it or changing connection does', () => {
        renderRecorder();
        choose(ReportKind.PROFILER, REPORT_A);
        choose(ReportKind.PERFORMANCE, REPORT_A);
        act(() => {
            store.set(activeProfilerReportAtom, null);
            store.set(activePerformanceReportAtom, null);
        });
        settleMemory(REPORT_A.path, settledMetadata(TARGET_DB_VERSION_MAX));
        settle(queries.performance, REPORT_A.path, settledRows);

        expect(recordReportLoaded).not.toHaveBeenCalled();
        expect(recordReportLoadFailed).not.toHaveBeenCalled();
        expect(getProbedPendingReportLoads()).toEqual({});
    });

    it('a report that settles without a pending choice, as a restored one does', () => {
        queries.metadata.set(REPORT_A.path, settledMetadata(TARGET_DB_VERSION_MAX + 1));
        queries.performance.set(REPORT_B.path, failed(HttpStatusCode.UnprocessableEntity));
        renderRecorder();
        act(() => {
            store.set(activeProfilerReportAtom, REPORT_A);
            store.set(activePerformanceReportAtom, REPORT_B);
        });

        expect(recordReportLoaded).not.toHaveBeenCalled();
        expect(recordReportLoadFailed).not.toHaveBeenCalled();
    });

    it('a second time, once the outcome is recorded', () => {
        renderRecorder();
        choose(ReportKind.PROFILER, REPORT_A);
        settleMemory(REPORT_A.path, settledMetadata(TARGET_DB_VERSION_MAX));
        settleMemory(REPORT_A.path, settledMetadata(TARGET_DB_VERSION_MAX));

        expect(recordReportLoaded).toHaveBeenCalledTimes(1);
    });

    it('a second time when the recorder mounts under StrictMode with the outcome already settled', () => {
        // Settled before mounting, as when `Layout` remounts while a marker is still pending
        queries.metadata.set(REPORT_A.path, settledMetadata(TARGET_DB_VERSION_MAX));
        queries.operations.set(REPORT_A.path, settledOperations);
        queries.performance.set(REPORT_B.path, settledRows);
        store.set(activeProfilerReportAtom, REPORT_A);
        store.set(activePerformanceReportAtom, REPORT_B);
        markPending(ReportKind.PROFILER, REPORT_A.path, ReportSource.LOCAL_TT_METAL);
        markPending(ReportKind.PERFORMANCE, REPORT_B.path, ReportSource.LOCAL_TT_METAL);

        render(<StrictMode>{recorderTree()}</StrictMode>);

        expect(recordReportLoaded).toHaveBeenCalledTimes(2);
        expect(recordReportLoaded).toHaveBeenCalledWith(ReportKind.PROFILER, ReportSource.LOCAL_TT_METAL);
        expect(recordReportLoaded).toHaveBeenCalledWith(ReportKind.PERFORMANCE, ReportSource.LOCAL_TT_METAL);
    });
});

describe('marking a choice pending', () => {
    const METADATA_A = [REPORT_METADATA_QUERY_KEY, REPORT_A.path];
    const OPERATIONS_A = [OPERATIONS_QUERY_KEY, REPORT_A.path];
    const METADATA_B = [REPORT_METADATA_QUERY_KEY, REPORT_B.path];

    const renderMark = (queryClient: QueryClient) =>
        renderHook(() => useMarkReportLoadPending(), {
            wrapper: ({ children }: { children: ReactNode }) => (
                <QueryClientProvider client={queryClient}>
                    <Provider store={store}>{children}</Provider>
                </QueryClientProvider>
            ),
        }).result.current;

    // Both reads are keyed by folder path alone and never go stale. Left cached, a report chosen
    // again would settle from an earlier attempt: an error since recovered from, or another
    // location's report with the same folder name.
    it("forgets the chosen memory report's cached reads, and only its own", () => {
        const queryClient = new QueryClient();
        queryClient.setQueryData(METADATA_A, { version: { major: 1, minor: 0, patch: 0 } });
        queryClient.setQueryData(OPERATIONS_A, []);
        queryClient.setQueryData(METADATA_B, { version: { major: 1, minor: 0, patch: 0 } });

        const mark = renderMark(queryClient);
        act(() => mark(ReportKind.PROFILER, REPORT_A.path, ReportSource.LOCAL_TT_METAL));

        expect(queryClient.getQueryData(METADATA_A)).toBeUndefined();
        expect(queryClient.getQueryData(OPERATIONS_A)).toBeUndefined();
        expect(queryClient.getQueryData(METADATA_B)).toBeDefined();
        expect(store.get(pendingReportLoadsAtom)).toEqual({
            [ReportKind.PROFILER]: { path: REPORT_A.path, source: ReportSource.LOCAL_TT_METAL },
        });
    });

    it('leaves the memory reads alone for a performance choice', () => {
        const queryClient = new QueryClient();
        queryClient.setQueryData(METADATA_A, { version: { major: 1, minor: 0, patch: 0 } });

        const mark = renderMark(queryClient);
        act(() => mark(ReportKind.PERFORMANCE, REPORT_A.path, ReportSource.UPLOAD));

        expect(queryClient.getQueryData(METADATA_A)).toBeDefined();
    });
});
