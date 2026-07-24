// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportLinkMatchResult } from '../src/definitions/ReportLinks';
import { useReportLinkMatch } from '../src/hooks/useReportLinkMatch';
import { activePerformanceReportAtom, activeProfilerReportAtom } from '../src/store/app';
import { AtomProvider, type AtomProviderInitialValues } from './helpers/atomProvider';

const apiState = vi.hoisted(() => {
    type RunIdQuery = {
        isFetched: boolean;
        isFetching: boolean;
        isError: boolean;
        error: Error | null;
        data: { runId: string | null } | undefined;
    };

    const settledQuery = (data: { runId: string | null }): RunIdQuery => ({
        isFetched: true,
        isFetching: false,
        isError: false,
        error: null,
        data,
    });

    return {
        matchedOperations: [] as unknown[],
        operations: { isFetched: true, isFetching: false, isError: false },
        devices: { isFetched: true, isFetching: false, isError: false },
        performance: { isFetched: true, isFetching: false, isError: false },
        reportMetadata: settledQuery({ runId: null }) as RunIdQuery,
        performanceManifest: settledQuery({ runId: null }) as RunIdQuery,
        settledQuery,
    };
});

const { settledQuery } = apiState;

const pendingQuery = {
    isFetched: false,
    isFetching: true,
    isError: false,
    error: null,
    data: undefined,
};

const errorQuery = {
    isFetched: true,
    isFetching: false,
    isError: true,
    error: new Error('failed'),
    data: undefined,
};

vi.mock('../src/hooks/useAPI', () => ({
    useGetDeviceOperationListPerf: () => apiState.matchedOperations,
    useOperationsList: () => apiState.operations,
    useDevices: () => apiState.devices,
    usePerformanceReport: () => apiState.performance,
    useReportMetadata: () => apiState.reportMetadata,
    usePerformanceManifest: () => apiState.performanceManifest,
}));

const PROFILER = { path: 'mem-run', reportName: 'mem-run' };
const PERFORMANCE = { path: 'perf-run', reportName: 'perf-run' };
const SHARED_RUN_ID = '3122e52b-3417-4c39-ae20-0a26dff1be8a';

const settledOk = () => {
    apiState.matchedOperations = [];
    apiState.operations = { isFetched: true, isFetching: false, isError: false };
    apiState.devices = { isFetched: true, isFetching: false, isError: false };
    apiState.performance = { isFetched: true, isFetching: false, isError: false };
    apiState.reportMetadata = settledQuery({ runId: null });
    apiState.performanceManifest = settledQuery({ runId: null });
};

const wrapperWithReports =
    (initialValues: AtomProviderInitialValues = []) =>
    ({ children }: { children: ReactNode }) => (
        <AtomProvider
            initialValues={[
                [activeProfilerReportAtom, PROFILER],
                [activePerformanceReportAtom, PERFORMANCE],
                ...initialValues,
            ]}
        >
            {children}
        </AtomProvider>
    );

describe('useReportLinkMatch', () => {
    beforeEach(() => {
        settledOk();
    });

    it('returns UNAVAILABLE when either active report is missing', () => {
        const { result } = renderHook(() => useReportLinkMatch(), {
            wrapper: ({ children }) => (
                <AtomProvider initialValues={[[activeProfilerReportAtom, PROFILER]]}>{children}</AtomProvider>
            ),
        });

        expect(result.current).toBe(ReportLinkMatchResult.UNAVAILABLE);
    });

    it('returns LINKED when both run_ids are present and equal', () => {
        apiState.reportMetadata = settledQuery({ runId: SHARED_RUN_ID });
        apiState.performanceManifest = settledQuery({ runId: SHARED_RUN_ID });
        apiState.matchedOperations = [];

        const { result } = renderHook(() => useReportLinkMatch(), {
            wrapper: wrapperWithReports(),
        });

        expect(result.current).toBe(ReportLinkMatchResult.LINKED);
    });

    it('returns UNLINKED when both run_ids are present but differ, ignoring op matches', () => {
        apiState.reportMetadata = settledQuery({ runId: SHARED_RUN_ID });
        apiState.performanceManifest = settledQuery({ runId: 'different-run-id' });
        apiState.matchedOperations = [{ id: 1 }];

        const { result } = renderHook(() => useReportLinkMatch(), {
            wrapper: wrapperWithReports(),
        });

        expect(result.current).toBe(ReportLinkMatchResult.UNLINKED);
    });

    it('returns PENDING while run_id queries are in flight', () => {
        apiState.reportMetadata = pendingQuery;
        apiState.matchedOperations = [{ id: 1 }];

        const { result } = renderHook(() => useReportLinkMatch(), {
            wrapper: wrapperWithReports(),
        });

        expect(result.current).toBe(ReportLinkMatchResult.PENDING);
    });

    it('falls back to op matching when only one side has a run_id', () => {
        apiState.reportMetadata = settledQuery({ runId: SHARED_RUN_ID });
        apiState.performanceManifest = settledQuery({ runId: null });
        apiState.matchedOperations = [{ id: 1 }];

        const { result } = renderHook(() => useReportLinkMatch(), {
            wrapper: wrapperWithReports(),
        });

        expect(result.current).toBe(ReportLinkMatchResult.LINKED);
    });

    it('falls back to op matching when run_id queries error (legacy reports)', () => {
        apiState.reportMetadata = errorQuery;
        apiState.performanceManifest = settledQuery({ runId: null });
        apiState.matchedOperations = [{ id: 1 }];

        const { result } = renderHook(() => useReportLinkMatch(), {
            wrapper: wrapperWithReports(),
        });

        expect(result.current).toBe(ReportLinkMatchResult.LINKED);
    });

    it('returns LINKED when matched operations exist and run_ids are absent', () => {
        apiState.matchedOperations = [{ id: 1 }];
        apiState.operations = { isFetched: false, isFetching: true, isError: false };

        const { result } = renderHook(() => useReportLinkMatch(), {
            wrapper: wrapperWithReports(),
        });

        expect(result.current).toBe(ReportLinkMatchResult.LINKED);
    });

    it('returns PENDING while queries are in flight and there are no matches', () => {
        apiState.operations = { isFetched: false, isFetching: true, isError: false };

        const { result } = renderHook(() => useReportLinkMatch(), {
            wrapper: wrapperWithReports(),
        });

        expect(result.current).toBe(ReportLinkMatchResult.PENDING);
    });

    it('returns PENDING when fetched but still fetching', () => {
        apiState.performance = { isFetched: true, isFetching: true, isError: false };

        const { result } = renderHook(() => useReportLinkMatch(), {
            wrapper: wrapperWithReports(),
        });

        expect(result.current).toBe(ReportLinkMatchResult.PENDING);
    });

    it('returns UNLINKED when settled with no matches and no errors', () => {
        const { result } = renderHook(() => useReportLinkMatch(), {
            wrapper: wrapperWithReports(),
        });

        expect(result.current).toBe(ReportLinkMatchResult.UNLINKED);
    });

    it('returns UNAVAILABLE when settled with a query error', () => {
        apiState.devices = { isFetched: true, isFetching: false, isError: true };

        const { result } = renderHook(() => useReportLinkMatch(), {
            wrapper: wrapperWithReports(),
        });

        expect(result.current).toBe(ReportLinkMatchResult.UNAVAILABLE);
    });
});
