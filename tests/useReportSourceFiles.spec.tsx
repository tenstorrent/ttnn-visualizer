// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useSetAtom } from 'jotai';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Endpoints from '../src/definitions/Endpoints';
import { ReportFolder } from '../src/definitions/Reports';
import { useReportSourceFiles } from '../src/hooks/useAPI';
import axiosInstance from '../src/libs/axiosInstance';
import { activeProfilerReportAtom } from '../src/store/app';
import { AtomProvider } from './helpers/atomProvider';
import { PROFILER_REPORT } from './helpers/reportLinkFixtures';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
    },
    getOrCreateInstanceId: () => 'test-instance',
}));

const OTHER_PROFILER_REPORT: ReportFolder = {
    path: '/data/local/profiler-reports/mem-other',
    reportName: 'mem-other',
};

const useSourceFilesWithSetter = () => ({
    sourceFiles: useReportSourceFiles(),
    setActiveProfilerReport: useSetAtom(activeProfilerReportAtom),
});

const renderWithProfilerReport = (profiler: ReportFolder | null) =>
    renderHook(useSourceFilesWithSetter, {
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={new QueryClient()}>
                <AtomProvider initialValues={[[activeProfilerReportAtom, profiler]]}>{children}</AtomProvider>
            </QueryClientProvider>
        ),
    });

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(axiosInstance.get).mockResolvedValue({
        data: [
            { id: 1, path: '/a.py' },
            { id: 2, path: '/b.py' },
        ],
    });
});

describe('useReportSourceFiles', () => {
    it("reads the report's source files into sets of ids and paths", async () => {
        const { result } = renderWithProfilerReport(PROFILER_REPORT);

        await waitFor(() => expect(result.current.sourceFiles.data).toBeDefined());

        expect(axiosInstance.get).toHaveBeenCalledWith(Endpoints.SOURCE_FILES);
        expect(result.current.sourceFiles.data).toEqual({
            ids: new Set([1, 2]),
            paths: new Set(['/a.py', '/b.py']),
        });
    });

    it('asks nothing while no memory report is open', () => {
        renderWithProfilerReport(null);

        expect(axiosInstance.get).not.toHaveBeenCalled();
    });

    it('reads them again for another memory report', async () => {
        const { result } = renderWithProfilerReport(PROFILER_REPORT);
        await waitFor(() => expect(result.current.sourceFiles.data).toBeDefined());

        act(() => result.current.setActiveProfilerReport(OTHER_PROFILER_REPORT));

        await waitFor(() => expect(axiosInstance.get).toHaveBeenCalledTimes(2));
    });
});
