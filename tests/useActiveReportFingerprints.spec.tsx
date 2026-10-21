// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * A local pick does not clear the query cache, so the report data a verdict is drawn
 * from stays on whichever run each side was first read at. The fingerprints must
 * follow the same per-side lifetime, or a pick of one side records the other side's
 * newer run against a verdict computed from its older one (#2069).
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useSetAtom } from 'jotai';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useActiveReportFingerprints } from '../src/hooks/useAPI';
import { useReportLinkBadgeRuns } from '../src/hooks/useReportLinkBadgeRuns';
import { activePerformanceReportAtom, activeProfilerReportAtom, reportLinksAtom } from '../src/store/app';
import { ReportFolder } from '../src/definitions/Reports';
import { ActiveReportRuns, ReportLink } from '../src/model/ReportLinks';
import axiosInstance from '../src/libs/axiosInstance';
import { AtomProvider, type AtomProviderInitialValues } from './helpers/atomProvider';
import { PERFORMANCE_REPORT, PROFILER_REPORT, createReportLink } from './helpers/reportLinkFixtures';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
    },
    getOrCreateInstanceId: () => 'test-instance',
}));

const OTHER_PERFORMANCE_REPORT: ReportFolder = {
    path: '/data/local/performance-reports/perf-other',
    reportName: 'perf-other',
};

/** What the instance answers with: the folders it has active, and the runs they hold. */
const serverRuns = (profiler: [string, string] | null, performance: [string, string] | null): ActiveReportRuns => ({
    profiler: { folder: profiler?.[0] ?? null, run: profiler?.[1] ?? null },
    performance: { folder: performance?.[0] ?? null, run: performance?.[1] ?? null },
});

const answerWith = (runs: ActiveReportRuns) => vi.mocked(axiosInstance.get).mockResolvedValue({ data: runs });

const useFingerprintsWithSetters = () => ({
    fingerprints: useActiveReportFingerprints(),
    setActivePerformanceReport: useSetAtom(activePerformanceReportAtom),
});

const createWrapper =
    (initialValues: AtomProviderInitialValues, queryClient = new QueryClient()) =>
    ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <AtomProvider initialValues={initialValues}>{children}</AtomProvider>
        </QueryClientProvider>
    );

const activeReports = (profiler: ReportFolder | null, performance: ReportFolder | null): AtomProviderInitialValues => [
    [activeProfilerReportAtom, profiler],
    [activePerformanceReportAtom, performance],
];

const renderWithActiveReports = (
    profiler: ReportFolder | null,
    performance: ReportFolder | null,
    queryClient?: QueryClient,
) =>
    renderHook(useFingerprintsWithSetters, {
        wrapper: createWrapper(activeReports(profiler, performance), queryClient),
    });

beforeEach(() => {
    vi.clearAllMocks();
});

describe('useActiveReportFingerprints', () => {
    it('keeps the profiler run when only the performance report changes', async () => {
        answerWith(serverRuns(['mem-run', 'v1:mem-first-run'], ['perf-run', 'v1:perf-run']));
        const { result } = renderWithActiveReports(PROFILER_REPORT, PERFORMANCE_REPORT);

        await waitFor(() => expect(result.current.fingerprints.isPending).toBe(false));
        expect(result.current.fingerprints.data).toEqual({ profiler: 'v1:mem-first-run', performance: 'v1:perf-run' });

        // The memory folder was rewritten in place, then a new perf report picked locally.
        answerWith(serverRuns(['mem-run', 'v1:mem-second-run'], ['perf-other', 'v1:perf-other']));
        act(() => result.current.setActivePerformanceReport(OTHER_PERFORMANCE_REPORT));

        await waitFor(() => expect(result.current.fingerprints.data.performance).toBe('v1:perf-other'));
        expect(result.current.fingerprints.data.profiler).toBe('v1:mem-first-run');
    });

    it('is not pending on a side with no active report', async () => {
        answerWith(serverRuns(['mem-run', 'v1:mem-run'], null));
        const { result } = renderWithActiveReports(PROFILER_REPORT, null);

        await waitFor(() => expect(result.current.fingerprints.isPending).toBe(false));
        expect(result.current.fingerprints.data).toEqual({ profiler: 'v1:mem-run', performance: null });
    });

    it('does not keep a run the instance read from a later pick', async () => {
        // A second pick reached the instance before this request did.
        answerWith(serverRuns(['mem-run', 'v1:mem-run'], ['perf-other', 'v1:perf-other']));
        const queryClient = new QueryClient();
        const first = renderWithActiveReports(PROFILER_REPORT, PERFORMANCE_REPORT, queryClient);

        await waitFor(() => expect(first.result.current.fingerprints.isPending).toBe(false));
        expect(first.result.current.fingerprints.data.performance).toBeNull();
        first.unmount();

        // Returning to the report asks again instead of serving the other report's run.
        answerWith(serverRuns(['mem-run', 'v1:mem-run'], ['perf-run', 'v1:perf-run']));
        const second = renderWithActiveReports(PROFILER_REPORT, PERFORMANCE_REPORT, queryClient);

        await waitFor(() => expect(second.result.current.fingerprints.data.performance).toBe('v1:perf-run'));
    });

    it('keeps a run read once for as long as the report stays active', async () => {
        // Report data is read once per report, so a later read of a rewritten folder
        // would stamp the newer run on a verdict drawn from the older one.
        answerWith(serverRuns(['mem-run', 'v1:mem-first-run'], ['perf-run', 'v1:perf-run']));
        const queryClient = new QueryClient();
        const first = renderWithActiveReports(PROFILER_REPORT, PERFORMANCE_REPORT, queryClient);
        await waitFor(() => expect(first.result.current.fingerprints.isPending).toBe(false));
        first.unmount();

        answerWith(serverRuns(['mem-run', 'v1:mem-second-run'], ['perf-run', 'v1:perf-run']));
        const second = renderWithActiveReports(PROFILER_REPORT, PERFORMANCE_REPORT, queryClient);

        expect(second.result.current.fingerprints.data.profiler).toBe('v1:mem-first-run');
        expect(axiosInstance.get).toHaveBeenCalledTimes(2);
    });
});

describe('useReportLinkBadgeRuns with the active runs read from the instance', () => {
    const link = (overrides: Partial<ReportLink>): ReportLink => createReportLink('mem-run', 'perf-run', overrides);

    it('checks each side against the run its own folder holds', async () => {
        answerWith(serverRuns(['mem-run', 'v1:mem-new'], ['perf-run', 'v1:perf-new']));
        const links = [
            link({ performanceId: 'perf-stale', profilerRun: 'v1:mem-old' }),
            link({ performanceId: 'perf-current', profilerRun: 'v1:mem-new' }),
            link({ profilerId: 'mem-stale', performanceRun: 'v1:perf-old' }),
            link({ profilerId: 'mem-current', performanceRun: 'v1:perf-new' }),
        ];
        const { result } = renderHook(() => useReportLinkBadgeRuns(), {
            wrapper: createWrapper([
                [reportLinksAtom, links],
                ...activeReports(PROFILER_REPORT, PERFORMANCE_REPORT),
            ] as AtomProviderInitialValues),
        });

        await waitFor(() => expect(result.current.linkedPerfRuns.has('perf-stale')).toBe(false));
        expect([...result.current.linkedPerfRuns.keys()]).toEqual(['perf-current']);
        expect([...result.current.linkedProfilerReportRuns.keys()]).toEqual(['mem-current']);
    });
});
