// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestProviders } from './helpers/TestProviders';
import getAllButtonsWithText from './helpers/getAllButtonsWithText';
import testForPortal from './helpers/testForPortal';
import { minimalValidNpeData, npeWindow, summary } from './helpers/npeFixtures';
import { noSshConfigResult } from './helpers/sshConfigFixtures';
import mockProfilerFolderList from './data/mockProfilerFolderList.json';
import mockPerformanceReportFolders from './data/mockPerformanceReportFolders.json';
import ProtectedRoute from '../src/components/ProtectedRoute';
import Home from '../src/routes/Home';
import NPE from '../src/routes/NPE';
import ROUTES, { ROUTE_PATTERNS } from '../src/definitions/Routes';
import Endpoints from '../src/definitions/Endpoints';
import { TEST_IDS } from '../src/definitions/TestIds';
import { ReportKind, ReportSource } from '../src/definitions/EventLogEvent';
import { ReportLocation } from '../src/definitions/Reports';
import { RemoteConnection, RemoteFolder } from '../src/model/RemoteConnection';
import {
    LOCAL_STORAGE_KEY_CONNECTIONS,
    LOCAL_STORAGE_KEY_SELECTED,
    savedPerformanceFoldersKey,
    savedReportFoldersKey,
} from '../src/hooks/useRemote';

// Boot restoration must not count as a user-initiated report load. Unlike the hook-level
// cases in useRestoreInstance.spec, these mount the real report-selection surface (Home's
// local and remote selectors, the NPE route and its windowed view) behind ProtectedRoute,
// so recording moved into a broad active-report or loaded-data effect anywhere in that
// tree fails here.

const h = vi.hoisted(() => ({
    serverMode: false as boolean,
    instance: null as unknown,
}));

const { recordReportLoaded, recordReportLoadFailed, mockUpdateInstance, mockAxiosPost, useSshConfigHostsMock } =
    vi.hoisted(() => ({
        recordReportLoaded: vi.fn(),
        recordReportLoadFailed: vi.fn(),
        mockUpdateInstance: vi.fn(),
        mockAxiosPost: vi.fn(),
        useSshConfigHostsMock: vi.fn(),
    }));

vi.mock('../src/functions/getServerConfig', () => ({ default: () => ({ SERVER_MODE: h.serverMode }) }));

vi.mock('../src/functions/reportLoadEvents', async (importOriginal) => {
    const { reportLoadEventsSpiesMock } = await import('./helpers/mockReportLoadEvents');

    return reportLoadEventsSpiesMock(importOriginal, recordReportLoaded, recordReportLoadFailed);
});

vi.mock('../src/hooks/useAPI', async () => {
    const actual = await vi.importActual<typeof import('../src/hooks/useAPI')>('../src/hooks/useAPI');

    return {
        ...actual,
        useInstance: () => ({ data: h.instance, isLoading: false }),
        useReportFolderList: () => ({ data: mockProfilerFolderList }),
        usePerfFolderList: () => ({ data: mockPerformanceReportFolders }),
        useGetClusterDescription: () => ({ data: null }),
        useReportMetadata: () => ({ data: undefined, error: null }),
        // The route passes null on the windowed path, which disables the whole-file query.
        useNpe: (fileName: string | null) => ({
            data: fileName ? minimalValidNpeData : undefined,
            isLoading: false,
            error: null,
        }),
        useNPETimelineFile: () => ({ data: undefined, isLoading: false, error: null }),
        useNpeSummary: () => ({ data: summary, isLoading: false, isError: false, error: null }),
        useNpeWindow: () => ({ data: npeWindow, isError: false, error: null }),
        updateInstance: (...args: unknown[]) => mockUpdateInstance(...args),
    };
});

// Tripwire: a request the useAPI overrides miss surfaces as a mock call, not a real fetch.
vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        post: (...args: unknown[]) => mockAxiosPost(...args),
        get: vi.fn(),
    },
}));

vi.mock('../src/hooks/useSshConfigHosts', () => ({ default: useSshConfigHostsMock }));

vi.mock('../src/components/npe/NPEViewComponent', () => ({
    default: () => <div data-testid={TEST_IDS.NPE_VIEW} />,
}));

const RESTORED_PROFILER = mockProfilerFolderList[0];
const RESTORED_PERFORMANCE = mockPerformanceReportFolders[0];
const RESTORED_NPE = 'restored-trace.json';

const REMOTE_PROFILER: RemoteFolder = {
    reportName: 'remote-profiler-report',
    remotePath: '/remote/profiler/remote-profiler-report',
    syncedName: 'remote-profiler-report-synced',
    lastModified: 1,
    lastSynced: 2,
};
const REMOTE_PERFORMANCE: RemoteFolder = {
    reportName: 'remote-performance-report',
    remotePath: '/remote/performance/remote-performance-report',
    syncedName: 'remote-performance-report-synced',
    lastModified: 1,
    lastSynced: 2,
};
const REMOTE_CONNECTION: RemoteConnection = {
    name: 'Restored',
    host: 'localhost',
    port: 2222,
    username: 'test-user',
    profilerPath: '/remote/profiler',
    performancePath: '/remote/performance',
};

const makeInstance = (location: ReportLocation, profiler: string, performance: string) => ({
    active_report: {
        profiler_name: profiler,
        profiler_location: location,
        performance_name: performance,
        performance_location: location,
        npe_name: RESTORED_NPE,
        mlir_name: null,
    },
    remote_profiler_folder: null,
});

const seedRemoteConnection = () => {
    window.localStorage.setItem(LOCAL_STORAGE_KEY_CONNECTIONS, JSON.stringify([REMOTE_CONNECTION]));
    window.localStorage.setItem(LOCAL_STORAGE_KEY_SELECTED, JSON.stringify(REMOTE_CONNECTION));
    window.localStorage.setItem(savedReportFoldersKey(REMOTE_CONNECTION), JSON.stringify([REMOTE_PROFILER]));
    window.localStorage.setItem(savedPerformanceFoldersKey(REMOTE_CONNECTION), JSON.stringify([REMOTE_PERFORMANCE]));
};

const renderRestored = (path: string) =>
    render(
        <TestProviders initialEntries={[path]}>
            <ProtectedRoute>
                <Routes>
                    <Route
                        path='/'
                        element={<Home />}
                    />
                    <Route
                        path={ROUTE_PATTERNS.NPE}
                        element={<NPE />}
                    />
                </Routes>
            </ProtectedRoute>
        </TestProviders>,
    );

// Restoration-driven work is deferred (queueMicrotask in RemoteSyncConfigurator, settle
// effects in the NPE views), so flush it before asserting nothing was recorded.
const settle = () => act(async () => {});

const expectNothingRecorded = () => {
    expect(recordReportLoaded).not.toHaveBeenCalled();
    expect(recordReportLoadFailed).not.toHaveBeenCalled();
};

beforeEach(() => {
    h.serverMode = false;
    h.instance = makeInstance(ReportLocation.LOCAL, RESTORED_PROFILER.path, RESTORED_PERFORMANCE.path);
    useSshConfigHostsMock.mockReturnValue(noSshConfigResult());
    mockUpdateInstance.mockResolvedValue({});
    mockAxiosPost.mockImplementation((endpoint: string) => {
        if (endpoint === Endpoints.REMOTE_LOCAL_PROFILER_REPORTS) {
            return Promise.resolve({ status: 200, data: [REMOTE_PROFILER] });
        }

        if (endpoint === Endpoints.REMOTE_LOCAL_PERFORMANCE_REPORTS) {
            return Promise.resolve({ status: 200, data: [REMOTE_PERFORMANCE] });
        }

        return Promise.resolve({ status: 200, data: [] });
    });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
});

describe('boot-restored reports on Home', () => {
    it('records no load when local profiler and performance reports are restored', async () => {
        renderRestored(ROUTES.HOME);

        await waitFor(() => expect(getAllButtonsWithText(RESTORED_PROFILER.reportName)).toHaveLength(1));
        expect(getAllButtonsWithText(RESTORED_PERFORMANCE.reportName)).toHaveLength(1);
        await settle();

        expectNothingRecorded();
    });

    it('records no load when remote profiler and performance reports are restored', async () => {
        seedRemoteConnection();
        h.instance = makeInstance(ReportLocation.REMOTE, REMOTE_PROFILER.syncedName!, REMOTE_PERFORMANCE.syncedName!);

        renderRestored(ROUTES.HOME);

        await waitFor(() => {
            const remoteSelects = screen.getAllByTestId(TEST_IDS.REMOTE_FOLDER_SELECTOR_BUTTON);

            expect(remoteSelects[0]).toHaveTextContent(REMOTE_PROFILER.reportName);
            expect(remoteSelects[1]).toHaveTextContent(REMOTE_PERFORMANCE.reportName);
        });
        await settle();

        expectNothingRecorded();
    });

    it('still records a user selection made after restoration', async () => {
        const nextProfiler = mockProfilerFolderList[1];

        renderRestored(ROUTES.HOME);

        await waitFor(() => expect(getAllButtonsWithText(RESTORED_PROFILER.reportName)).toHaveLength(1));
        await settle();
        expectNothingRecorded();

        getAllButtonsWithText(RESTORED_PROFILER.reportName)[0].click();
        await waitFor(testForPortal);
        screen.getByText(nextProfiler.reportName).click();

        await waitFor(() => expect(recordReportLoaded).toHaveBeenCalledTimes(1));
        expect(recordReportLoaded).toHaveBeenCalledWith(ReportKind.PROFILER, ReportSource.LOCAL_TT_METAL);
        expect(recordReportLoadFailed).not.toHaveBeenCalled();
    });
});

describe('boot-restored NPE report', () => {
    it.each([
        { serverMode: true, path: 'whole-file' },
        { serverMode: false, path: 'windowed' },
    ])('records no load on the $path path', async ({ serverMode }) => {
        h.serverMode = serverMode;

        renderRestored(ROUTES.NPE);

        await waitFor(() => expect(screen.getByTestId(TEST_IDS.NPE_VIEW)).toBeInTheDocument());
        await settle();

        expectNothingRecorded();
    });
});
