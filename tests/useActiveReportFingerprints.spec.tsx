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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useActiveReportFingerprints } from '../src/hooks/useAPI';
import { activePerformanceReportAtom, activeProfilerReportAtom } from '../src/store/app';
import { ReportFolder } from '../src/definitions/Reports';
import { ActiveReportFingerprints } from '../src/model/ReportLinks';
import axiosInstance from '../src/libs/axiosInstance';
import { AtomProvider } from './helpers/atomProvider';
import { QueryProvider } from './helpers/queryClientProvider';
import { PERFORMANCE_REPORT, PROFILER_REPORT } from './helpers/reportLinkFixtures';

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

const FIRST_RUNS: ActiveReportFingerprints = { profiler: 'v1:mem-first-run', performance: 'v1:perf-run' };
const SECOND_RUNS: ActiveReportFingerprints = { profiler: 'v1:mem-second-run', performance: 'v1:perf-other' };

const useFingerprintsWithSetters = () => ({
    fingerprints: useActiveReportFingerprints(),
    setActivePerformanceReport: useSetAtom(activePerformanceReportAtom),
});

const renderWithActiveReports = (profiler: ReportFolder | null, performance: ReportFolder | null) =>
    renderHook(useFingerprintsWithSetters, {
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryProvider>
                <AtomProvider
                    initialValues={[
                        [activeProfilerReportAtom, profiler],
                        [activePerformanceReportAtom, performance],
                    ]}
                >
                    {children}
                </AtomProvider>
            </QueryProvider>
        ),
    });

beforeEach(() => {
    vi.clearAllMocks();
});

describe('useActiveReportFingerprints', () => {
    it('keeps the profiler run when only the performance report changes', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValue({ data: FIRST_RUNS });
        const { result } = renderWithActiveReports(PROFILER_REPORT, PERFORMANCE_REPORT);

        await waitFor(() => expect(result.current.fingerprints.isPending).toBe(false));
        expect(result.current.fingerprints.data).toEqual(FIRST_RUNS);

        // The memory folder was rewritten in place, then a new perf report picked locally.
        vi.mocked(axiosInstance.get).mockResolvedValue({ data: SECOND_RUNS });
        act(() => result.current.setActivePerformanceReport(OTHER_PERFORMANCE_REPORT));

        await waitFor(() => expect(result.current.fingerprints.data.performance).toBe(SECOND_RUNS.performance));
        expect(result.current.fingerprints.data.profiler).toBe(FIRST_RUNS.profiler);
    });

    it('is not pending on a side with no active report', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValue({ data: { ...FIRST_RUNS, performance: null } });
        const { result } = renderWithActiveReports(PROFILER_REPORT, null);

        await waitFor(() => expect(result.current.fingerprints.isPending).toBe(false));
        expect(result.current.fingerprints.data).toEqual({ profiler: FIRST_RUNS.profiler, performance: null });
    });
});
