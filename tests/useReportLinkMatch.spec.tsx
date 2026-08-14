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

const apiState = vi.hoisted(() => ({
    matchedOperations: [] as unknown[],
    operations: { isFetched: true, isFetching: false, isError: false },
    devices: { isFetched: true, isFetching: false, isError: false },
    performance: { isFetched: true, isFetching: false, isError: false },
}));

vi.mock('../src/hooks/useAPI', () => ({
    useGetDeviceOperationListPerf: () => apiState.matchedOperations,
    useOperationsList: () => apiState.operations,
    useDevices: () => apiState.devices,
    useLinkedPerformanceReport: () => apiState.performance,
}));

const PROFILER = { path: 'mem-run', reportName: 'mem-run' };
const PERFORMANCE = { path: 'perf-run', reportName: 'perf-run' };

const settledOk = () => {
    apiState.matchedOperations = [];
    apiState.operations = { isFetched: true, isFetching: false, isError: false };
    apiState.devices = { isFetched: true, isFetching: false, isError: false };
    apiState.performance = { isFetched: true, isFetching: false, isError: false };
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

    it('returns LINKED when matched operations exist, even while queries are fetching', () => {
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
