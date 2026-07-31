// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The `?name=` parameter addresses a report by the folder it occupies on disk. A
 * synced multihost report lives in `<name>_rank<N>`, so sending the report's own
 * name reaches a directory that does not exist — or, worse, another rank's.
 */

import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useAtomValue } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePerfMeta, usePerformanceReport } from '../src/hooks/useAPI';
import { activePerformanceReportAtom, activePerformanceReportFolderNameAtom } from '../src/store/app';
import { ReportFolder } from '../src/definitions/Reports';
import { AtomProvider } from './helpers/atomProvider';
import { QueryProvider } from './helpers/queryClientProvider';
import axiosInstance from '../src/libs/axiosInstance';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
    },
}));

const TIMESTAMP = '2026_07_31_17_20_53';
const SYNCED_NAME = `${TIMESTAMP}_rank1`;
const REMOTE_PATH = `/localdev/me/tt-metal/generated/profiler/ttrun/rank1/reports/${TIMESTAMP}`;

/** A report that has just been picked in the remote selector: `path` is still remote. */
const freshlySelected: ReportFolder = {
    path: REMOTE_PATH,
    reportName: TIMESTAMP,
    syncedName: SYNCED_NAME,
};

/** The same report after a reload, rebuilt from the instance's stored local path. */
const restored: ReportFolder = {
    path: SYNCED_NAME,
    reportName: SYNCED_NAME,
    syncedName: SYNCED_NAME,
};

/** A local report, which is never rank-qualified and carries no synced name. */
const local: ReportFolder = {
    path: TIMESTAMP,
    reportName: TIMESTAMP,
};

const renderWithActiveReport = <T,>(hook: () => T, activeReport: ReportFolder | null) =>
    renderHook(hook, {
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryProvider>
                <AtomProvider initialValues={activeReport ? [[activePerformanceReportAtom, activeReport]] : []}>
                    {children}
                </AtomProvider>
            </QueryProvider>
        ),
    });

const getRequestedName = (call: unknown[]): unknown => (call[1] as { params: { name: unknown } }).params.name;

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(axiosInstance.get).mockResolvedValue({ data: {} });
});

describe('activePerformanceReportFolderNameAtom', () => {
    it('names the rank-qualified folder for a freshly selected multihost report', () => {
        const { result } = renderWithActiveReport(
            () => useAtomValue(activePerformanceReportFolderNameAtom),
            freshlySelected,
        );

        expect(result.current).toBe(SYNCED_NAME);
    });

    it('names the same folder after a reload', () => {
        const { result } = renderWithActiveReport(() => useAtomValue(activePerformanceReportFolderNameAtom), restored);

        expect(result.current).toBe(SYNCED_NAME);
    });

    it('falls back to the folder a local report occupies', () => {
        const { result } = renderWithActiveReport(() => useAtomValue(activePerformanceReportFolderNameAtom), local);

        expect(result.current).toBe(TIMESTAMP);
    });

    it('is null when no report is active', () => {
        const { result } = renderWithActiveReport(() => useAtomValue(activePerformanceReportFolderNameAtom), null);

        expect(result.current).toBeNull();
    });
});

describe('performance requests for a multihost report', () => {
    it('asks for the rank-qualified folder, not the report name', async () => {
        renderWithActiveReport(() => {
            const name = useAtomValue(activePerformanceReportFolderNameAtom);

            return usePerformanceReport(name);
        }, freshlySelected);

        await waitFor(() => expect(axiosInstance.get).toHaveBeenCalled());

        const call = vi.mocked(axiosInstance.get).mock.calls[0];
        expect(call[0]).toContain('perf-results/report');
        expect(getRequestedName(call)).toBe(SYNCED_NAME);
    });

    it('asks device meta for the rank-qualified folder too', async () => {
        renderWithActiveReport(() => {
            const name = useAtomValue(activePerformanceReportFolderNameAtom);

            return usePerfMeta(name);
        }, freshlySelected);

        await waitFor(() => expect(axiosInstance.get).toHaveBeenCalled());

        const call = vi.mocked(axiosInstance.get).mock.calls[0];
        expect(call[0]).toContain('device-log/meta');
        expect(getRequestedName(call)).toBe(SYNCED_NAME);
    });
});
