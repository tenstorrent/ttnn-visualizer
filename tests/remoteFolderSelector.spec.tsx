// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Classes } from '@blueprintjs/core';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { AxiosResponse } from 'axios';
import { useAtomValue } from 'jotai';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import RemoteSyncConfigurator from '../src/components/report-selection/RemoteSyncConfigurator';
import RemoteFolderSelector from '../src/components/report-selection/RemoteFolderSelector';
import LocalFolderSelector from '../src/components/report-selection/LocalFolderSelector';
import Endpoints from '../src/definitions/Endpoints';
import { ACTIVE_PERFORMANCE_REPORT_TOAST_TITLE } from '../src/definitions/notifyActiveReport';
import { RemoteConnection, RemoteFolder } from '../src/definitions/RemoteConnection';
import { TEST_IDS } from '../src/definitions/TestIds';
import { LOCAL_STORAGE_KEY_CONNECTIONS, LOCAL_STORAGE_KEY_SELECTED } from '../src/hooks/useRemote';
import { isActivatingReportAtom } from '../src/store/app';
import {
    FOLDER_LIST_SYNC_ERROR_TOAST_TITLE,
    FOLDER_SYNC_ERROR_TOAST_TITLE,
    REMOTE_FOLDER_MOUNT_ERROR_TOAST_TITLE,
} from '../src/functions/notifyFolderSyncError';
import {
    FOLDER_SYNC_LOCAL_FALLBACK_TOAST_TITLE,
    LOCAL_SYNCED_REPORTS_TOAST_TITLE,
} from '../src/functions/notifyFolderSyncLocalFallback';
import mockInstance from './data/mockInstance.json';
import mockPerformanceReportFolders from './data/mockPerformanceReportFolders.json';
import mockProfilerFolderList from './data/mockProfilerFolderList.json';
import mockRemotePerformanceFolderList from './data/mockRemotePerformanceFolderList.json';
import mockRemoteProfilerFolderList from './data/mockRemoteProfilerFolderList.json';
import remoteConnection from './data/remoteConnection.json';
import getAllButtonsWithText from './helpers/getAllButtonsWithText';
import getButtonWithText from './helpers/getButtonWithText';
import testForPortal from './helpers/testForPortal';
import { TestProviders } from './helpers/TestProviders';

// Scrub the markup after each test
afterEach(() => {
    cleanup();
    window.localStorage.clear();
});

const WAIT_FOR_OPTIONS = { timeout: 1000 };
const ADD_NEW_CONNECTION = 'Add new connection';
const NO_CONNECTION = '(No connection)';
const EDIT_NEW_CONNECTION = 'Edit selected connection';
const REMOVE_NEW_CONNECTION = 'Remove selected connection';
const FETCH_REMOTE_FOLDERS = 'Fetch remote folders';
const CONNECTION_NAME = 'Local - ssh://localhost:2222/';
const NO_SELECTION = '(No selection)';

const HTML_DISABLED = 'disabled';
const SELECT_LOCAL_REPORT_TEXT = 'Select a report...';
const IS_ACTIVATING_REPORT_PROBE_TEST_ID = 'is-activating-report-probe';

const IsActivatingReportProbe = () => {
    const isActivatingReport = useAtomValue(isActivatingReportAtom);

    return <span data-testid={IS_ACTIVATING_REPORT_PROBE_TEST_ID}>{isActivatingReport ? 'true' : 'false'}</span>;
};

const { mockUseReportFolderList, mockUsePerfFolderList, mockUseInstance, mockUseReportMetadata } = vi.hoisted(() => {
    return {
        mockUseReportFolderList: vi.fn(),
        mockUsePerfFolderList: vi.fn(),
        mockUseInstance: vi.fn(),
        mockUseReportMetadata: vi.fn(),
    };
});

vi.mock('../src/hooks/useAPI.tsx', async () => {
    const actual = await vi.importActual<typeof import('../src/hooks/useAPI.tsx')>('../src/hooks/useAPI.tsx');

    return {
        ...actual,
        useReportFolderList: () => mockUseReportFolderList(),
        usePerfFolderList: () => mockUsePerfFolderList(),
        useInstance: () => mockUseInstance(),
        useReportMetadata: () => mockUseReportMetadata(),
        updateInstance: vi.fn().mockResolvedValue({}),
        deleteProfiler: vi.fn().mockResolvedValue({ success: true }),
        deletePerformance: vi.fn().mockResolvedValue({ success: true }),
    };
});

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        post: vi.fn(),
    },
}));

beforeEach(() => {
    vi.resetAllMocks();
    mockUseReportFolderList.mockReturnValue({ data: mockProfilerFolderList });
    mockUsePerfFolderList.mockReturnValue({ data: mockPerformanceReportFolders });
    mockUseInstance.mockReturnValue({ data: mockInstance });
    // No active report metadata by default; effect short-circuits.
    mockUseReportMetadata.mockReturnValue({ data: undefined, error: undefined });
    // Clean up localStorage between tests
    window.localStorage.clear();
});

it('shows a loading spinner on the remote folder selector button when loading', () => {
    render(
        <TestProviders>
            <RemoteFolderSelector
                remoteFolderList={mockRemoteProfilerFolderList as RemoteFolder[]}
                loading
                onSelectFolder={() => undefined}
                type='profiler'
            />
        </TestProviders>,
    );

    const button = screen.getByTestId(TEST_IDS.REMOTE_FOLDER_SELECTOR_BUTTON);
    expect(button.classList.contains(Classes.LOADING)).toBe(true);
    expect(button).toHaveProperty('disabled', true);
});

it('disables remote selectors while an active report is being confirmed without a spinner', () => {
    setupConnection(remoteConnection);

    render(
        <TestProviders initialAtomValues={[[isActivatingReportAtom, true]]}>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    const selectButtons = screen.queryAllByTestId(TEST_IDS.REMOTE_FOLDER_SELECTOR_BUTTON);
    expect(selectButtons.length).toBeGreaterThan(0);
    selectButtons.forEach((button) => {
        expect(button.classList.contains(Classes.LOADING)).toBe(false);
        expect(button).toHaveProperty(HTML_DISABLED, true);
    });
    expect(screen.queryByTestId(TEST_IDS.REMOTE_SYNC_BUTTON)).toBeNull();
});

it('renders the initial form state when there is no data', () => {
    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    const reportSelects = getAllButtonsWithText(NO_SELECTION);

    expect(getButtonWithText(ADD_NEW_CONNECTION)).not.toBeNull();
    expect(getButtonWithText(NO_CONNECTION)).not.toBeNull();
    expect(getButtonWithText(EDIT_NEW_CONNECTION)).toHaveProperty(HTML_DISABLED, true);
    expect(getButtonWithText(REMOVE_NEW_CONNECTION)).toHaveProperty(HTML_DISABLED, true);
    expect(getButtonWithText(FETCH_REMOTE_FOLDERS)).toHaveProperty(HTML_DISABLED, true);
    expect(reportSelects).toHaveLength(2);

    reportSelects.forEach((select) => {
        expect(select).toHaveProperty(HTML_DISABLED, true);
    });
});

it('enables fetch remote folder list button when a connection is selected', () => {
    setupConnection(remoteConnection);

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    const reportSelects = getAllButtonsWithText(NO_SELECTION);
    const fetchButton = getButtonWithText(FETCH_REMOTE_FOLDERS);

    expect(getButtonWithText(CONNECTION_NAME)).not.toBeNull();
    expect(getButtonWithText(EDIT_NEW_CONNECTION)).toHaveProperty(HTML_DISABLED, false);
    expect(getButtonWithText(REMOVE_NEW_CONNECTION)).toHaveProperty(HTML_DISABLED, false);
    expect(getButtonWithText(FETCH_REMOTE_FOLDERS)).toHaveProperty(HTML_DISABLED, false);
    expect(reportSelects).toHaveLength(2);

    reportSelects.forEach((select) => {
        expect(select).toHaveProperty(HTML_DISABLED, true);
    });

    expect(fetchButton).toHaveProperty(HTML_DISABLED, false);
});

it('clears localStorage and resets state when removing a connection', () => {
    setupConnection(remoteConnection);

    const { rerender } = render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Verify connection exists initially
    expect(getButtonWithText(CONNECTION_NAME)).not.toBeNull();
    expect(getButtonWithText(REMOVE_NEW_CONNECTION)).toHaveProperty(HTML_DISABLED, false);

    // Clear localStorage to simulate connection removal
    window.localStorage.removeItem(LOCAL_STORAGE_KEY_CONNECTIONS);
    window.localStorage.removeItem(LOCAL_STORAGE_KEY_SELECTED);

    rerender(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Verify UI resets to no connection state
    expect(getButtonWithText(NO_CONNECTION)).not.toBeNull();
    expect(getButtonWithText(EDIT_NEW_CONNECTION)).toHaveProperty(HTML_DISABLED, true);
    expect(getButtonWithText(REMOVE_NEW_CONNECTION)).toHaveProperty(HTML_DISABLED, true);
    expect(getButtonWithText(FETCH_REMOTE_FOLDERS)).toHaveProperty(HTML_DISABLED, true);
});

it('handles multiple remote connections in localStorage', () => {
    const multipleConnections: RemoteConnection[] = [
        remoteConnection[0],
        {
            name: 'Production Server',
            username: 'prod-user',
            host: 'prod.example.com',
            port: 22,
            profilerPath: '/opt/reports',
            performancePath: '/opt/perf',
        },
    ];

    setupConnection(multipleConnections);

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Should show the first connection by default
    expect(getButtonWithText(CONNECTION_NAME)).not.toBeNull();
    expect(getButtonWithText(EDIT_NEW_CONNECTION)).toHaveProperty(HTML_DISABLED, false);
    expect(getButtonWithText(REMOVE_NEW_CONNECTION)).toHaveProperty(HTML_DISABLED, false);
});

it('displays correct connection information format', () => {
    const customConnection: RemoteConnection[] = [
        {
            name: 'Test Connection',
            username: 'testuser',
            host: 'test.example.com',
            port: 2222,
            profilerPath: '/test/profiler',
            performancePath: '/test/performance',
        },
    ];

    setupConnection(customConnection);

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Verify the connection display format
    expect(getButtonWithText('Test Connection - ssh://test.example.com:2222/')).not.toBeNull();
});

it('handles localStorage parsing errors gracefully', () => {
    // Set invalid JSON in localStorage
    window.localStorage.setItem(LOCAL_STORAGE_KEY_CONNECTIONS, 'invalid-json');

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Should fall back to no connection state
    expect(getButtonWithText(NO_CONNECTION)).not.toBeNull();
    expect(getButtonWithText(EDIT_NEW_CONNECTION)).toHaveProperty(HTML_DISABLED, true);
    expect(getButtonWithText(REMOVE_NEW_CONNECTION)).toHaveProperty(HTML_DISABLED, true);
});

it('handles API errors gracefully', () => {
    mockUsePerfFolderList.mockReturnValue({
        data: null,
        isLoading: false,
        error: new Error('Network error'),
    });

    setupConnection(remoteConnection);

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Component should still render and handle the error state
    expect(getButtonWithText(FETCH_REMOTE_FOLDERS)).not.toBeNull();

    // Report selects should remain disabled on error
    const reportSelects = getAllButtonsWithText(NO_SELECTION);
    reportSelects.forEach((select) => {
        expect(select).toHaveProperty(HTML_DISABLED, true);
    });
});

it('sets active performance report by mounting local copy on selection without syncing', async () => {
    const axiosInstance = await import('../src/libs/axiosInstance');
    const mockPost = vi.mocked(axiosInstance.default.post);

    const selectedReport: RemoteFolder = {
        ...mockRemotePerformanceFolderList[0],
        lastSynced: mockRemotePerformanceFolderList[0].lastModified + 1000,
    };

    mockPost.mockImplementation((url: string) => mockRemoteFolderApis(url, selectedReport));

    setupConnection(remoteConnection);

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    await selectPerformanceFolder(selectedReport.remotePath);

    const { remotePath } = selectedReport;
    const formattedPath = remotePath.split('/').filter(Boolean).at(-1) ?? remotePath;

    await waitFor(
        () => expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain(formattedPath),
        WAIT_FOR_OPTIONS,
    );

    expect(mockPost.mock.calls.some(([url]) => String(url).includes('/api/remote/use'))).toBe(true);
    expect(mockPost.mock.calls.some(([url]) => String(url).includes('/api/remote/sync'))).toBe(false);

    const syncButton = await screen.findByTestId(TEST_IDS.REMOTE_SYNC_BUTTON, undefined, WAIT_FOR_OPTIONS);
    expect(syncButton.classList.contains(Classes.INTENT_SUCCESS)).toBe(true);
});

it('disables remote report selectors while mount is confirming the active report', async () => {
    const axiosInstance = await import('../src/libs/axiosInstance');
    const mockPost = vi.mocked(axiosInstance.default.post);

    const selectedReport: RemoteFolder = {
        ...mockRemotePerformanceFolderList[0],
        lastSynced: mockRemotePerformanceFolderList[0].lastModified + 1000,
    };

    let resolveMount: ((value: AxiosResponse) => void) | undefined;
    mockPost.mockImplementation((url: string) => {
        if (url.includes('/api/remote/use')) {
            return new Promise<AxiosResponse>((resolve) => {
                resolveMount = resolve;
            });
        }

        return mockRemoteFolderApis(url, selectedReport);
    });

    setupConnection(remoteConnection);

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    await selectPerformanceFolder(selectedReport.remotePath);

    await waitFor(() => {
        const selectButtons = screen.queryAllByTestId(TEST_IDS.REMOTE_FOLDER_SELECTOR_BUTTON);
        expect(selectButtons.length).toBeGreaterThan(0);
        selectButtons.forEach((button) => {
            expect(button).toHaveProperty(HTML_DISABLED, true);
            expect(button.classList.contains(Classes.LOADING)).toBe(false);
        });
        // Sync stays gated on REMOTE location until mount+activate completes.
        expect(screen.queryByTestId(TEST_IDS.REMOTE_SYNC_BUTTON)).toBeNull();
    }, WAIT_FOR_OPTIONS);

    expect(resolveMount).toBeDefined();
    resolveMount!({ status: 200, data: {} } as AxiosResponse);

    await waitFor(
        () => expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain(selectedReport.reportName),
        WAIT_FOR_OPTIONS,
    );

    await waitFor(() => {
        const selectButtons = screen.queryAllByTestId(TEST_IDS.REMOTE_FOLDER_SELECTOR_BUTTON);
        const enabledButtons = selectButtons.filter((btn) => !btn.hasAttribute(HTML_DISABLED));
        expect(enabledButtons.length).toBeGreaterThan(0);
        enabledButtons.forEach((button) => {
            expect(button.classList.contains(Classes.LOADING)).toBe(false);
        });
        expect(screen.getByTestId(TEST_IDS.REMOTE_SYNC_BUTTON)).toHaveProperty(HTML_DISABLED, false);
    }, WAIT_FOR_OPTIONS);
});

it('re-enables remote report selectors when mount fails', async () => {
    const axiosInstance = await import('../src/libs/axiosInstance');
    const mockPost = vi.mocked(axiosInstance.default.post);

    const selectedReport: RemoteFolder = {
        ...mockRemotePerformanceFolderList[0],
        lastSynced: mockRemotePerformanceFolderList[0].lastModified + 1000,
    };

    let rejectMount: ((reason?: unknown) => void) | undefined;
    mockPost.mockImplementation((url: string) => {
        if (url.includes('/api/remote/use')) {
            return new Promise<AxiosResponse>((_resolve, reject) => {
                rejectMount = reject;
            });
        }

        return mockRemoteFolderApis(url, selectedReport);
    });

    setupConnection(remoteConnection);

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    await selectPerformanceFolder(selectedReport.remotePath);

    await waitFor(() => {
        const selectButtons = screen.queryAllByTestId(TEST_IDS.REMOTE_FOLDER_SELECTOR_BUTTON);
        selectButtons.forEach((button) => {
            expect(button).toHaveProperty(HTML_DISABLED, true);
        });
    }, WAIT_FOR_OPTIONS);

    expect(rejectMount).toBeDefined();
    rejectMount!(new Error('Unable to establish SSH connection'));

    await waitFor(() => {
        const selectButtons = screen.queryAllByTestId(TEST_IDS.REMOTE_FOLDER_SELECTOR_BUTTON);
        const enabledButtons = selectButtons.filter((btn) => !btn.hasAttribute(HTML_DISABLED));
        expect(enabledButtons.length).toBeGreaterThan(0);
    }, WAIT_FOR_OPTIONS);
});

it('mounts a previously synced outdated performance folder on selection without syncing', async () => {
    const axiosInstance = await import('../src/libs/axiosInstance');
    const mockPost = vi.mocked(axiosInstance.default.post);

    const selectedReport: RemoteFolder = {
        ...mockRemotePerformanceFolderList[0],
        lastSynced: mockRemotePerformanceFolderList[0].lastModified - 1000,
    };

    mockPost.mockImplementation((url: string) => mockRemoteFolderApis(url, selectedReport));

    setupConnection(remoteConnection);

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    await selectPerformanceFolder(selectedReport.remotePath);

    await waitFor(
        () => expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain(selectedReport.reportName),
        WAIT_FOR_OPTIONS,
    );

    expect(mockPost.mock.calls.some(([url]) => String(url).includes('/api/remote/sync'))).toBe(false);
    expect(mockPost.mock.calls.some(([url]) => String(url).includes('/api/remote/use'))).toBe(true);
});

it('mounts a previously synced outdated memory folder on selection without syncing', async () => {
    const axiosInstance = await import('../src/libs/axiosInstance');
    const mockPost = vi.mocked(axiosInstance.default.post);

    const selectedReport: RemoteFolder = {
        ...mockRemoteProfilerFolderList[1],
        lastSynced: mockRemoteProfilerFolderList[1].lastModified - 1000,
    };

    mockPost.mockImplementation((url: string) => mockRemoteFolderApis(url, selectedReport));

    const connectionWithProfiler: RemoteConnection[] = [
        {
            ...remoteConnection[0],
            profilerPath: '/test/data/profiler',
        },
    ];
    setupConnection(connectionWithProfiler);

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    await selectProfilerFolder(selectedReport.remotePath);

    await waitFor(
        () => expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain(selectedReport.reportName),
        WAIT_FOR_OPTIONS,
    );

    expect(mockPost.mock.calls.some(([url]) => String(url).includes('/api/remote/sync'))).toBe(false);
    expect(mockPost.mock.calls.some(([url]) => String(url).includes('/api/remote/use'))).toBe(true);
});

it('does not activate remote report when a local report is chosen mid-sync', async () => {
    const axiosInstance = await import('../src/libs/axiosInstance');
    const mockPost = vi.mocked(axiosInstance.default.post);

    const selectedReport: RemoteFolder = {
        ...mockRemotePerformanceFolderList[0],
        lastSynced: null,
    };
    const syncedReport: RemoteFolder = {
        ...selectedReport,
        lastSynced: selectedReport.lastModified + 1000,
    };
    const localPerfFolder = mockPerformanceReportFolders[0];

    let resolveSync: ((value: AxiosResponse) => void) | undefined;
    mockPost.mockImplementation((url: string) => {
        if (url.includes('/api/remote/sync')) {
            return new Promise<AxiosResponse>((resolve) => {
                resolveSync = resolve;
            });
        }

        return mockRemoteFolderApis(url, selectedReport);
    });

    setupConnection(remoteConnection);

    render(
        <TestProviders>
            <LocalFolderSelector />
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    await selectPerformanceFolder(selectedReport.remotePath);

    await waitFor(() => {
        expect(resolveSync).toBeDefined();
        getAllButtonsWithText(SELECT_LOCAL_REPORT_TEXT).forEach((button) => {
            expect(button).toHaveProperty(HTML_DISABLED, false);
        });
    }, WAIT_FOR_OPTIONS);

    // Activate a local performance report while the remote sync is still in flight.
    getAllButtonsWithText(SELECT_LOCAL_REPORT_TEXT)[1].click();
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);
    screen.getByText(new RegExp(localPerfFolder.path, 'i')).click();

    await waitFor(
        () => expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain(localPerfFolder.reportName),
        WAIT_FOR_OPTIONS,
    );

    const useCallsBeforeResolve = mockPost.mock.calls.filter(([url]) => String(url).includes('/api/remote/use')).length;

    resolveSync!({ status: 200, data: syncedReport } as AxiosResponse);

    await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain(localPerfFolder.reportName);
    }, WAIT_FOR_OPTIONS);

    const useCallsAfterResolve = mockPost.mock.calls.filter(([url]) => String(url).includes('/api/remote/use')).length;
    expect(useCallsAfterResolve).toBe(useCallsBeforeResolve);
    expect(screen.queryByText(ACTIVE_PERFORMANCE_REPORT_TOAST_TITLE)).toBeTruthy();
});

it('does not spin local report selectors while a remote sync transfer is in flight', async () => {
    const axiosInstance = await import('../src/libs/axiosInstance');
    const mockPost = vi.mocked(axiosInstance.default.post);

    const selectedReport: RemoteFolder = {
        ...mockRemotePerformanceFolderList[0],
        lastSynced: null,
    };
    const syncedReport: RemoteFolder = {
        ...selectedReport,
        lastSynced: selectedReport.lastModified + 1000,
    };

    let resolveSync: ((value: AxiosResponse) => void) | undefined;
    mockPost.mockImplementation((url: string) => {
        if (url.includes('/api/remote/sync')) {
            return new Promise<AxiosResponse>((resolve) => {
                resolveSync = resolve;
            });
        }

        return mockRemoteFolderApis(url, selectedReport);
    });

    setupConnection(remoteConnection);

    render(
        <TestProviders>
            <IsActivatingReportProbe />
            <LocalFolderSelector />
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    await selectPerformanceFolder(selectedReport.remotePath);

    await waitFor(() => {
        const remoteButtons = screen.queryAllByTestId(TEST_IDS.REMOTE_FOLDER_SELECTOR_BUTTON);
        expect(remoteButtons.length).toBeGreaterThan(0);
        remoteButtons.forEach((button) => {
            expect(button).toHaveProperty(HTML_DISABLED, true);
            expect(button.classList.contains(Classes.LOADING)).toBe(false);
        });
        expect(screen.getByTestId(IS_ACTIVATING_REPORT_PROBE_TEST_ID).textContent).toBe('false');
        expect(screen.getByTestId(TEST_IDS.REMOTE_SYNC_BUTTON)).toHaveProperty(HTML_DISABLED, true);
        getAllButtonsWithText(SELECT_LOCAL_REPORT_TEXT).forEach((button) => {
            expect(button.classList.contains(Classes.LOADING)).toBe(false);
            expect(button).toHaveProperty(HTML_DISABLED, false);
        });
    }, WAIT_FOR_OPTIONS);

    expect(resolveSync).toBeDefined();
    resolveSync!({ status: 200, data: syncedReport } as AxiosResponse);

    await waitFor(
        () => expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain(selectedReport.reportName),
        WAIT_FOR_OPTIONS,
    );
});

it('falls back to the local copy when never-synced select sync fails', async () => {
    const axiosInstance = await import('../src/libs/axiosInstance');
    const mockPost = vi.mocked(axiosInstance.default.post);

    const selectedReport: RemoteFolder = {
        ...mockRemotePerformanceFolderList[0],
        lastSynced: null,
    };
    const syncErrorMessage = 'Unable to establish SSH connection';

    mockPost.mockImplementation((url: string) => {
        if (url.includes('/api/remote/sync')) {
            return Promise.reject(new Error(syncErrorMessage));
        }

        return mockRemoteFolderApis(url, selectedReport);
    });

    setupConnection(remoteConnection);

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    await selectPerformanceFolder(selectedReport.remotePath);

    await waitFor(() => {
        expect(screen.getByText(FOLDER_SYNC_LOCAL_FALLBACK_TOAST_TITLE)).not.toBeNull();
    }, WAIT_FOR_OPTIONS);

    expect(mockPost.mock.calls.some(([url]) => String(url).includes('/api/remote/sync'))).toBe(true);
    expect(mockPost.mock.calls.some(([url]) => String(url).includes('/api/remote/use'))).toBe(true);
});

it('mounts the local copy and warns when Sync fails for a previously synced folder', async () => {
    const axiosInstance = await import('../src/libs/axiosInstance');
    const mockPost = vi.mocked(axiosInstance.default.post);

    const selectedReport: RemoteFolder = {
        ...mockRemotePerformanceFolderList[0],
        lastSynced: mockRemotePerformanceFolderList[0].lastModified + 1000,
    };
    const syncErrorMessage = 'Unable to establish SSH connection';

    mockPost.mockImplementation((url: string) => {
        if (url.includes('/api/remote/sync')) {
            return Promise.reject(new Error(syncErrorMessage));
        }

        return mockRemoteFolderApis(url, selectedReport);
    });

    setupConnection(remoteConnection);

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    await selectPerformanceFolder(selectedReport.remotePath);

    await waitFor(
        () => expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain(selectedReport.reportName),
        WAIT_FOR_OPTIONS,
    );

    const syncButton = await screen.findByTestId(TEST_IDS.REMOTE_SYNC_BUTTON, undefined, WAIT_FOR_OPTIONS);
    mockPost.mockClear();
    syncButton.click();

    await waitFor(() => {
        expect(screen.getByText(FOLDER_SYNC_LOCAL_FALLBACK_TOAST_TITLE)).not.toBeNull();
        const toastDetails = screen.getAllByTestId(TEST_IDS.TOAST_FILENAME).map((el) => el.textContent ?? '');
        expect(toastDetails.some((text) => text.includes(syncErrorMessage))).toBe(true);
    }, WAIT_FOR_OPTIONS);

    expect(mockPost.mock.calls.some(([url]) => String(url).includes('/api/remote/sync'))).toBe(true);
    expect(mockPost.mock.calls.some(([url]) => String(url).includes('/api/remote/use'))).toBe(true);
    expect(screen.queryByText(FOLDER_SYNC_ERROR_TOAST_TITLE)).toBeNull();
});

it('shows Folder sync error when Sync and local mount both fail', async () => {
    const axiosInstance = await import('../src/libs/axiosInstance');
    const mockPost = vi.mocked(axiosInstance.default.post);

    const selectedReport: RemoteFolder = {
        ...mockRemotePerformanceFolderList[0],
        lastSynced: mockRemotePerformanceFolderList[0].lastModified + 1000,
    };
    const syncErrorMessage = 'Unable to establish SSH connection';
    let rejectLocalMount = false;

    mockPost.mockImplementation((url: string) => {
        if (url.includes('/api/remote/sync')) {
            return Promise.reject(new Error(syncErrorMessage));
        }

        if (rejectLocalMount && url.includes('/api/remote/use')) {
            return Promise.reject(new Error('Local mount failed'));
        }

        return mockRemoteFolderApis(url, selectedReport);
    });

    setupConnection(remoteConnection);

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    await selectPerformanceFolder(selectedReport.remotePath);

    await waitFor(
        () => expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain(selectedReport.reportName),
        WAIT_FOR_OPTIONS,
    );

    const syncButton = await screen.findByTestId(TEST_IDS.REMOTE_SYNC_BUTTON, undefined, WAIT_FOR_OPTIONS);
    mockPost.mockClear();
    rejectLocalMount = true;
    syncButton.click();

    await waitFor(() => {
        expect(screen.getByText(FOLDER_SYNC_ERROR_TOAST_TITLE)).not.toBeNull();
        expect(screen.queryByText(FOLDER_SYNC_LOCAL_FALLBACK_TOAST_TITLE)).toBeNull();
    }, WAIT_FOR_OPTIONS);
});

it('loads local synced reports when Fetch remote list fails but local list has folders', async () => {
    const axiosInstance = await import('../src/libs/axiosInstance');
    const mockPost = vi.mocked(axiosInstance.default.post);

    const localFolder: RemoteFolder = {
        ...mockRemotePerformanceFolderList[0],
        lastSynced: mockRemotePerformanceFolderList[0].lastModified + 1000,
    };

    mockPost.mockImplementation((url: string) => {
        if (url === Endpoints.REMOTE_PERFORMANCE_REPORTS) {
            return Promise.reject(new Error('SSH unreachable'));
        }

        if (url === Endpoints.REMOTE_LOCAL_PERFORMANCE_REPORTS) {
            return Promise.resolve({ status: 200, data: [localFolder] } as AxiosResponse);
        }

        if (url === Endpoints.REMOTE_PROFILER_REPORTS || url === Endpoints.REMOTE_LOCAL_PROFILER_REPORTS) {
            return Promise.resolve({ status: 204, data: '' } as AxiosResponse);
        }

        return mockRemoteFolderApis(url, localFolder);
    });

    setupConnection(remoteConnection);

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    getButtonWithText(FETCH_REMOTE_FOLDERS).click();

    await waitFor(() => {
        expect(screen.getByText(LOCAL_SYNCED_REPORTS_TOAST_TITLE)).not.toBeNull();
    }, WAIT_FOR_OPTIONS);

    await waitFor(() => {
        const selectButtons = screen.queryAllByTestId(TEST_IDS.REMOTE_FOLDER_SELECTOR_BUTTON);
        const enabledButtons = selectButtons.filter((btn) => !btn.hasAttribute(HTML_DISABLED));
        expect(enabledButtons.length).toBeGreaterThan(0);
    }, WAIT_FOR_OPTIONS);

    expect(mockPost.mock.calls.some(([url]) => url === Endpoints.REMOTE_LOCAL_PERFORMANCE_REPORTS)).toBe(true);
    expect(screen.queryByText(FOLDER_LIST_SYNC_ERROR_TOAST_TITLE)).toBeNull();
});

it('shows Folder list sync error when Fetch fails and local list is empty', async () => {
    const axiosInstance = await import('../src/libs/axiosInstance');
    const mockPost = vi.mocked(axiosInstance.default.post);

    mockPost.mockImplementation((url: string) => {
        if (url === Endpoints.REMOTE_PERFORMANCE_REPORTS) {
            return Promise.reject(new Error('SSH unreachable'));
        }

        if (url === Endpoints.REMOTE_LOCAL_PERFORMANCE_REPORTS) {
            return Promise.resolve({ status: 204, data: '' } as AxiosResponse);
        }

        if (url === Endpoints.REMOTE_PROFILER_REPORTS || url === Endpoints.REMOTE_LOCAL_PROFILER_REPORTS) {
            return Promise.resolve({ status: 204, data: '' } as AxiosResponse);
        }

        return Promise.resolve({ status: 200, data: {} } as AxiosResponse);
    });

    setupConnection(remoteConnection);

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    getButtonWithText(FETCH_REMOTE_FOLDERS).click();

    await waitFor(() => {
        expect(screen.getByText(FOLDER_LIST_SYNC_ERROR_TOAST_TITLE)).not.toBeNull();
    }, WAIT_FOR_OPTIONS);

    expect(screen.queryByText(LOCAL_SYNCED_REPORTS_TOAST_TITLE)).toBeNull();
});

it('seeds folder selects from local synced reports on mount without Fetch', async () => {
    const axiosInstance = await import('../src/libs/axiosInstance');
    const mockPost = vi.mocked(axiosInstance.default.post);

    const localFolder: RemoteFolder = {
        ...mockRemotePerformanceFolderList[0],
        lastSynced: mockRemotePerformanceFolderList[0].lastModified + 1000,
    };

    mockPost.mockImplementation((url: string) => {
        if (url === Endpoints.REMOTE_LOCAL_PERFORMANCE_REPORTS) {
            return Promise.resolve({ status: 200, data: [localFolder] } as AxiosResponse);
        }

        if (url === Endpoints.REMOTE_LOCAL_PROFILER_REPORTS) {
            return Promise.resolve({ status: 204, data: '' } as AxiosResponse);
        }

        return mockRemoteFolderApis(url, localFolder);
    });

    setupConnection(remoteConnection);

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    await waitFor(() => {
        expect(mockPost.mock.calls.some(([url]) => url === Endpoints.REMOTE_LOCAL_PERFORMANCE_REPORTS)).toBe(true);
    }, WAIT_FOR_OPTIONS);

    await waitFor(() => {
        const selectButtons = screen.queryAllByTestId(TEST_IDS.REMOTE_FOLDER_SELECTOR_BUTTON);
        const enabledButtons = selectButtons.filter((btn) => !btn.hasAttribute(HTML_DISABLED));
        expect(enabledButtons.length).toBeGreaterThan(0);
    }, WAIT_FOR_OPTIONS);

    expect(mockPost.mock.calls.some(([url]) => url === Endpoints.REMOTE_PERFORMANCE_REPORTS)).toBe(false);
});

it('clears cached performance folders when local mount scan returns empty', async () => {
    const axiosInstance = await import('../src/libs/axiosInstance');
    const mockPost = vi.mocked(axiosInstance.default.post);

    const staleFolder: RemoteFolder = {
        ...mockRemotePerformanceFolderList[0],
        lastSynced: mockRemotePerformanceFolderList[0].lastModified + 1000,
    };

    mockPost.mockImplementation((url: string) => {
        if (url === Endpoints.REMOTE_LOCAL_PERFORMANCE_REPORTS || url === Endpoints.REMOTE_LOCAL_PROFILER_REPORTS) {
            return Promise.resolve({ status: 204, data: '' } as AxiosResponse);
        }

        return Promise.resolve({ status: 200, data: {} } as AxiosResponse);
    });

    setupConnection(remoteConnection);
    window.localStorage.setItem(`${remoteConnection[0].name} - performanceFolders`, JSON.stringify([staleFolder]));

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Cached folders enable the selector until the empty local scan replaces them.
    expect(
        screen.queryAllByTestId(TEST_IDS.REMOTE_FOLDER_SELECTOR_BUTTON).some((btn) => !btn.hasAttribute(HTML_DISABLED)),
    ).toBe(true);

    await waitFor(() => {
        expect(mockPost.mock.calls.some(([url]) => url === Endpoints.REMOTE_LOCAL_PERFORMANCE_REPORTS)).toBe(true);
    }, WAIT_FOR_OPTIONS);

    await waitFor(() => {
        const selectButtons = screen.queryAllByTestId(TEST_IDS.REMOTE_FOLDER_SELECTOR_BUTTON);
        expect(selectButtons.every((btn) => btn.hasAttribute(HTML_DISABLED))).toBe(true);
        expect(
            JSON.parse(window.localStorage.getItem(`${remoteConnection[0].name} - performanceFolders`) ?? '[]'),
        ).toEqual([]);
    }, WAIT_FOR_OPTIONS);
});

it('toasts Unable to open report when up-to-date select mount fails', async () => {
    const axiosInstance = await import('../src/libs/axiosInstance');
    const mockPost = vi.mocked(axiosInstance.default.post);

    const selectedReport: RemoteFolder = {
        ...mockRemotePerformanceFolderList[0],
        lastSynced: mockRemotePerformanceFolderList[0].lastModified + 1000,
    };

    mockPost.mockImplementation((url: string) => {
        if (url.includes('/api/remote/use')) {
            return Promise.reject(new Error('Report is not synced locally'));
        }

        return mockRemoteFolderApis(url, selectedReport);
    });

    setupConnection(remoteConnection);

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    await selectPerformanceFolder(selectedReport.remotePath);

    await waitFor(() => {
        expect(screen.getByText(REMOTE_FOLDER_MOUNT_ERROR_TOAST_TITLE)).not.toBeNull();
    }, WAIT_FOR_OPTIONS);

    expect(screen.queryByText(ACTIVE_PERFORMANCE_REPORT_TOAST_TITLE)).toBeNull();
    expect(mockPost.mock.calls.some(([url]) => String(url).includes('/api/remote/sync'))).toBe(false);
    // Mount never activated REMOTE location, so Sync stays hidden.
    expect(screen.queryByTestId(TEST_IDS.REMOTE_SYNC_BUTTON)).toBeNull();
});

it('syncs a never-synced report on selection then mounts it', async () => {
    const axiosInstance = await import('../src/libs/axiosInstance');
    const mockPost = vi.mocked(axiosInstance.default.post);

    const neverSyncedReport: RemoteFolder = {
        ...mockRemotePerformanceFolderList[0],
        lastSynced: null,
    };
    const syncedReport: RemoteFolder = {
        ...neverSyncedReport,
        lastSynced: neverSyncedReport.lastModified + 1000,
    };

    mockPost.mockImplementation((url: string) => {
        if (url.includes('/api/remote/sync')) {
            return Promise.resolve({ status: 200, data: syncedReport } as AxiosResponse);
        }

        return mockRemoteFolderApis(url, neverSyncedReport);
    });

    setupConnection(remoteConnection);

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    await selectPerformanceFolder(neverSyncedReport.remotePath);

    await waitFor(() => {
        expect(screen.getByText(ACTIVE_PERFORMANCE_REPORT_TOAST_TITLE)).not.toBeNull();
    }, WAIT_FOR_OPTIONS);

    expect(mockPost.mock.calls.some(([url]) => String(url).includes('/api/remote/sync'))).toBe(true);
    expect(mockPost.mock.calls.some(([url]) => String(url).includes('/api/remote/use'))).toBe(true);
});

it('handles connection with default port (22)', () => {
    const connectionWithDefaultPort = [
        {
            ...remoteConnection[0],
            port: 22,
        },
    ];

    setupConnection(connectionWithDefaultPort);

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Should display connection without explicit port when it's the default
    expect(
        getButtonWithText(
            `${connectionWithDefaultPort[0].name} - ssh://${connectionWithDefaultPort[0].host}:${connectionWithDefaultPort[0].port}/`,
        ),
    ).not.toBeNull();
});

it('validates connection data structure', () => {
    const incompleteConnection: Partial<RemoteConnection>[] = [
        {
            name: 'Incomplete Connection',
            username: 'user',
            // Missing host, port, etc.
        },
    ];

    window.localStorage.setItem(LOCAL_STORAGE_KEY_CONNECTIONS, JSON.stringify(incompleteConnection));

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    expect(getButtonWithText(ADD_NEW_CONNECTION)).not.toBeNull();
    expect(getButtonWithText(NO_CONNECTION)).not.toBeNull();
});

it('maintains state consistency after localStorage changes', () => {
    // Remove previously set connections
    window.localStorage.removeItem(LOCAL_STORAGE_KEY_CONNECTIONS);

    const { rerender } = render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Initially no connections
    expect(getButtonWithText(NO_CONNECTION)).not.toBeNull();

    // Add connection to localStorage
    setupConnection(remoteConnection);

    rerender(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Should now show the connection
    expect(getButtonWithText(CONNECTION_NAME)).not.toBeNull();
    expect(getButtonWithText(EDIT_NEW_CONNECTION)).toHaveProperty(HTML_DISABLED, false);
});

it('shows an "Incompatible report version" toast when the active report uses an unsupported DB schema', async () => {
    mockUseReportMetadata.mockReturnValue({
        data: { version: { major: 999, minor: 0, patch: 0 } },
        error: undefined,
    });

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    await waitFor(
        () => expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain('v999.0.0'),
        WAIT_FOR_OPTIONS,
    );
});

it('displays appropriate connection count information', () => {
    const multipleConnections: RemoteConnection[] = [
        remoteConnection[0],
        {
            name: 'Second Connection',
            username: 'user2',
            host: 'server2.example.com',
            port: 22,
            profilerPath: '/path2',
            performancePath: '/perf2',
        },
    ];

    setupConnection(multipleConnections);

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Should show first connection by default
    expect(getButtonWithText(CONNECTION_NAME)).not.toBeNull();

    // All connection management buttons should be enabled
    expect(getButtonWithText(EDIT_NEW_CONNECTION)).toHaveProperty(HTML_DISABLED, false);
    expect(getButtonWithText(REMOVE_NEW_CONNECTION)).toHaveProperty(HTML_DISABLED, false);
    expect(getButtonWithText(FETCH_REMOTE_FOLDERS)).toHaveProperty(HTML_DISABLED, false);
});

const setupConnection = (connection: RemoteConnection[], selected?: RemoteConnection) => {
    window.localStorage.setItem(LOCAL_STORAGE_KEY_CONNECTIONS, JSON.stringify(connection));

    const initialConnection = selected ?? connection?.[0];

    if (initialConnection) {
        window.localStorage.setItem(LOCAL_STORAGE_KEY_SELECTED, JSON.stringify(initialConnection));
    }
};

const mockRemoteFolderApis = (url: string, selectedReport: RemoteFolder) => {
    if (url.includes('/api/remote/profiler-reports') && !url.includes('local-')) {
        return Promise.resolve({
            data: mockRemoteProfilerFolderList.map((folder) =>
                folder.remotePath === selectedReport.remotePath ? selectedReport : folder,
            ),
        } as AxiosResponse);
    }
    if (url.includes('/api/remote/performance-reports') && !url.includes('local-')) {
        return Promise.resolve({ data: [selectedReport] } as AxiosResponse);
    }
    if (url.includes('/api/remote/local-performance-reports')) {
        return Promise.resolve({ status: 200, data: [selectedReport] } as AxiosResponse);
    }
    if (url.includes('/api/remote/local-profiler-reports')) {
        return Promise.resolve({
            status: 200,
            data: mockRemoteProfilerFolderList.map((folder) =>
                folder.remotePath === selectedReport.remotePath ? selectedReport : folder,
            ),
        } as AxiosResponse);
    }
    if (url.includes('/api/remote/use')) {
        return Promise.resolve({ status: 200, data: {} } as AxiosResponse);
    }
    if (url.includes('/api/instance/update')) {
        return Promise.resolve({ status: 200, data: {} } as AxiosResponse);
    }
    if (url.includes('/api/remote/sync')) {
        return Promise.resolve({
            status: 200,
            data: selectedReport,
        } as AxiosResponse);
    }
    return Promise.resolve({ data: [] } as AxiosResponse);
};

const selectRemoteFolder = async (type: 'profiler' | 'performance', remotePath: string) => {
    const fetchButton = getButtonWithText(FETCH_REMOTE_FOLDERS);
    fetchButton.click();

    await waitFor(() => {
        const selectButtons = screen.queryAllByTestId(TEST_IDS.REMOTE_FOLDER_SELECTOR_BUTTON);
        const enabledButtons = selectButtons.filter((btn) => !btn.hasAttribute(HTML_DISABLED));
        expect(enabledButtons.length).toBeGreaterThan(0);
    }, WAIT_FOR_OPTIONS);

    const selectButtons = screen.queryAllByTestId(TEST_IDS.REMOTE_FOLDER_SELECTOR_BUTTON);
    const enabledButtons = selectButtons.filter((btn) => !btn.hasAttribute(HTML_DISABLED));
    // Layout is [profiler, performance]. Default fixture has empty profilerPath so only
    // performance is enabled; when both paths exist both buttons enable.
    const button = type === 'performance' ? enabledButtons[enabledButtons.length - 1] : selectButtons[0];
    expect(button).toBeDefined();
    expect(button).toHaveProperty(HTML_DISABLED, false);
    button!.click();

    await waitFor(testForPortal, WAIT_FOR_OPTIONS);

    screen.getByText(remotePath).click();
};

const selectProfilerFolder = (remotePath: string) => selectRemoteFolder('profiler', remotePath);
const selectPerformanceFolder = (remotePath: string) => selectRemoteFolder('performance', remotePath);

// TODO: Add more tests to cover remaining functionality and edge cases
// ❌ No test for clicking Edit button
// ❌ No test for clicking Remove button
// ❌ No test verifying error messages display
