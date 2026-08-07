// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { Classes } from '@blueprintjs/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AxiosResponse } from 'axios';
import { useAtomValue } from 'jotai';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import RemoteSyncConfigurator from '../src/components/report-selection/RemoteSyncConfigurator';
import RemoteFolderSelector from '../src/components/report-selection/RemoteFolderSelector';
import LocalFolderSelector from '../src/components/report-selection/LocalFolderSelector';
import { ConnectionNameSubject, getNameFieldLabel } from '../src/definitions/ConnectionDialog';
import { ConnectionStatus, ConnectionTestStates } from '../src/definitions/ConnectionStatus';
import Endpoints from '../src/definitions/Endpoints';
import { ACTIVE_PERFORMANCE_REPORT_TOAST_TITLE } from '../src/definitions/notifyActiveReport';
import { CONFIRM_DELETE_LABEL } from '../src/definitions/ManagedEntity';
import {
    FETCH_REMOTE_FOLDERS_LABEL,
    REMOTE_MEMORY_PATH_LABEL,
    RemoteConnection,
    RemoteFolder,
} from '../src/definitions/RemoteConnection';
import { SSH_HOST_LABEL, SSH_USERNAME_LABEL } from '../src/definitions/SshConnectionFields';
import { TEST_IDS } from '../src/definitions/TestIds';
import {
    LOCAL_STORAGE_KEY_CONNECTIONS,
    LOCAL_STORAGE_KEY_SELECTED,
    savedPerformanceFoldersKey,
    savedReportFoldersKey,
} from '../src/hooks/useRemote';
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
import { MULTIHOST_CHECKBOX_NAME } from './helpers/multihostCheckbox';
import {
    getConnectionTrigger,
    getDeleteConnectionLabel,
    getEditConnectionLabel,
} from './helpers/remoteConnectionSelectors';
import { SshConfigHostsQueryResult, noSshConfigResult } from './helpers/sshConfigFixtures';
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
const FETCH_REMOTE_FOLDERS = FETCH_REMOTE_FOLDERS_LABEL;
const CONNECTION_NAME = 'Local - ssh://localhost:2222/';
const NO_SELECTION = '(No selection)';

const HTML_DISABLED = 'disabled';
const SELECT_LOCAL_REPORT_TEXT = 'Select a report...';
const IS_ACTIVATING_REPORT_PROBE_TEST_ID = 'is-activating-report-probe';

const EDITED_CONNECTION_NAME = 'Renamed Server';
const CONNECTION_NAME_LABEL = getNameFieldLabel(ConnectionNameSubject.CONNECTION);

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

const useSshConfigHostsMock = vi.hoisted(() => vi.fn<(enabled?: boolean) => SshConfigHostsQueryResult>());

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
        // Present so an unmocked GET surfaces as an unexpected call rather than as
        // "axiosInstance.get is not a function" swallowed by a query's error state.
        get: vi.fn(),
    },
}));

// The edit dialog renders SshConfigHostPicker; without this it would issue a real request from
// jsdom, and the picker would be absent because the query failed rather than because of a fixture.
vi.mock('../src/hooks/useSshConfigHosts', () => ({ default: useSshConfigHostsMock }));

beforeEach(() => {
    vi.resetAllMocks();
    mockUseReportFolderList.mockReturnValue({ data: mockProfilerFolderList });
    mockUsePerfFolderList.mockReturnValue({ data: mockPerformanceReportFolders });
    mockUseInstance.mockReturnValue({ data: mockInstance });
    // No active report metadata by default; effect short-circuits.
    mockUseReportMetadata.mockReturnValue({ data: undefined, error: undefined });
    useSshConfigHostsMock.mockReturnValue(noSshConfigResult());
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
    expect(getButtonWithText(FETCH_REMOTE_FOLDERS)).toHaveProperty(HTML_DISABLED, false);
    expect(reportSelects).toHaveLength(2);

    reportSelects.forEach((select) => {
        expect(select).toHaveProperty(HTML_DISABLED, true);
    });

    expect(fetchButton).toHaveProperty(HTML_DISABLED, false);
});

it('clears localStorage and resets state when removing the only connection', async () => {
    setupConnection(remoteConnection);
    // The confirmation promises these go with the connection, so seed them to assert they do.
    window.localStorage.setItem(
        savedReportFoldersKey(remoteConnection[0]),
        JSON.stringify(mockRemoteProfilerFolderList),
    );
    window.localStorage.setItem(
        savedPerformanceFoldersKey(remoteConnection[0]),
        JSON.stringify(mockRemotePerformanceFolderList),
    );

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Verify connection exists initially
    expect(getButtonWithText(CONNECTION_NAME)).not.toBeNull();

    getButtonWithText(CONNECTION_NAME).click();
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);

    fireEvent.click(screen.getByLabelText(getDeleteConnectionLabel(remoteConnection[0])));
    fireEvent.click(screen.getByRole('button', { name: CONFIRM_DELETE_LABEL }));

    // Verify UI resets to no connection state
    await waitFor(() => expect(getButtonWithText(NO_CONNECTION)).not.toBeNull(), WAIT_FOR_OPTIONS);
    expect(JSON.parse(window.localStorage.getItem(LOCAL_STORAGE_KEY_CONNECTIONS) ?? '[]')).toEqual([]);
    expect(getButtonWithText(FETCH_REMOTE_FOLDERS)).toHaveProperty(HTML_DISABLED, true);
    expect(window.localStorage.getItem(savedReportFoldersKey(remoteConnection[0]))).toBeNull();
    expect(window.localStorage.getItem(savedPerformanceFoldersKey(remoteConnection[0]))).toBeNull();
});

it('empties the folder lists rather than reading the no-connection cache key when the last connection goes', async () => {
    setupConnection(remoteConnection);
    // No connection still produces a real cache key, so anything stored under it would be adopted
    // as the folder lists of a connection that no longer exists.
    window.localStorage.setItem(savedReportFoldersKey(), JSON.stringify(mockRemoteProfilerFolderList));
    window.localStorage.setItem(savedPerformanceFoldersKey(), JSON.stringify(mockRemotePerformanceFolderList));

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    getButtonWithText(CONNECTION_NAME).click();
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);

    fireEvent.click(screen.getByLabelText(getDeleteConnectionLabel(remoteConnection[0])));
    fireEvent.click(screen.getByRole('button', { name: CONFIRM_DELETE_LABEL }));

    await waitFor(() => expect(getButtonWithText(NO_CONNECTION)).not.toBeNull(), WAIT_FOR_OPTIONS);

    // The selectors enable themselves on a non-empty folder list, so staying disabled is what
    // distinguishes emptied lists from ones populated off the no-connection key.
    const reportSelects = screen.getAllByTestId(TEST_IDS.REMOTE_FOLDER_SELECTOR_BUTTON);

    expect(reportSelects).toHaveLength(2);
    reportSelects.forEach((select) => expect(select).toHaveProperty(HTML_DISABLED, true));

    // Nothing is left to scan on disk, so no local report listing should be attempted either.
    const axiosInstance = await import('../src/libs/axiosInstance');

    expect(vi.mocked(axiosInstance.default.post)).not.toHaveBeenCalledWith(
        Endpoints.REMOTE_LOCAL_PROFILER_REPORTS,
        expect.anything(),
        expect.anything(),
    );
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
});

it('keeps the selected connection when a different one is removed from its dropdown row', async () => {
    const middleConnection: RemoteConnection = {
        name: 'Middle Server',
        username: 'prod-user',
        host: 'middle.example.com',
        port: 22,
        profilerPath: '/opt/reports',
        performancePath: '/opt/perf',
    };
    const lastConnection: RemoteConnection = {
        name: 'Last Server',
        username: 'prod-user',
        host: 'last.example.com',
        port: 22,
        profilerPath: '/opt/reports',
        performancePath: '/opt/perf',
    };

    // The selection deliberately isn't the first entry: re-pointing it at index 0 would be
    // indistinguishable from preserving it otherwise.
    setupConnection([remoteConnection[0], middleConnection, lastConnection], lastConnection);

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    getConnectionTrigger(lastConnection).click();
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);

    fireEvent.click(screen.getByLabelText(getDeleteConnectionLabel(middleConnection)));
    fireEvent.click(screen.getByRole('button', { name: CONFIRM_DELETE_LABEL }));

    await waitFor(() => {
        const storedConnections = JSON.parse(window.localStorage.getItem(LOCAL_STORAGE_KEY_CONNECTIONS) ?? '[]');
        expect(storedConnections).toHaveLength(2);
    }, WAIT_FOR_OPTIONS);

    // The removal must not re-point the selection, which would also clear the active remote report.
    expect(getConnectionTrigger(lastConnection)).not.toBeNull();
    expect(JSON.parse(window.localStorage.getItem(LOCAL_STORAGE_KEY_SELECTED) ?? 'null')).toMatchObject({
        name: lastConnection.name,
    });

    // Persisting alone doesn't re-render, so assert the row is gone from the reopened dropdown
    // rather than trusting localStorage.
    getConnectionTrigger(lastConnection).click();
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);

    const remainingRows = screen.getAllByTestId(TEST_IDS.REMOTE_CONNECTION_ROW);

    expect(remainingRows).toHaveLength(2);
    remainingRows.forEach((row) => expect(row.textContent).not.toContain(middleConnection.name));
});

it('applies an edit to a connection that is not selected without changing the selection', async () => {
    const otherConnection: RemoteConnection = {
        name: 'Other Server',
        username: 'prod-user',
        host: 'other.example.com',
        port: 22,
        profilerPath: '/opt/reports',
        performancePath: '/opt/perf',
    };
    const passingTests: ConnectionStatus[] = [
        { status: ConnectionTestStates.OK, message: 'SSH connection established' },
        { status: ConnectionTestStates.OK, message: 'Found 3 memory reports' },
    ];

    const axiosInstance = await import('../src/libs/axiosInstance');
    const mockPost = vi.mocked(axiosInstance.default.post);

    setupConnection([remoteConnection[0], otherConnection], remoteConnection[0]);
    mockPost.mockImplementation((url: string) => {
        if (url === `${Endpoints.REMOTE}/test`) {
            return Promise.resolve({ data: passingTests } as AxiosResponse);
        }

        return Promise.resolve({ status: 204, data: '' } as AxiosResponse);
    });

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    getButtonWithText(CONNECTION_NAME).click();
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);

    fireEvent.click(screen.getByLabelText(getEditConnectionLabel(otherConnection)));
    fireEvent.change(screen.getByLabelText(CONNECTION_NAME_LABEL), { target: { value: EDITED_CONNECTION_NAME } });
    fireEvent.click(getButtonWithText('Run tests'));

    await waitFor(() => expect(getButtonWithText('Save connection')).toBeEnabled(), WAIT_FOR_OPTIONS);
    fireEvent.click(getButtonWithText('Save connection'));

    await waitFor(() => {
        const storedConnections = JSON.parse(window.localStorage.getItem(LOCAL_STORAGE_KEY_CONNECTIONS) ?? '[]');
        expect(storedConnections.map((connection: RemoteConnection) => connection.name)).toEqual([
            remoteConnection[0].name,
            EDITED_CONNECTION_NAME,
        ]);
    }, WAIT_FOR_OPTIONS);

    // Re-pointing the selection here would also clear the active remote report, and fetching folder
    // lists would populate them for a connection that isn't in use.
    expect(JSON.parse(window.localStorage.getItem(LOCAL_STORAGE_KEY_SELECTED) ?? 'null')).toMatchObject({
        name: remoteConnection[0].name,
    });
    expect(getButtonWithText(CONNECTION_NAME)).not.toBeNull();

    const listedEndpoints: string[] = [Endpoints.REMOTE_PROFILER_REPORTS, Endpoints.REMOTE_PERFORMANCE_REPORTS];
    expect(mockPost.mock.calls.some(([url]) => listedEndpoints.includes(url))).toBe(false);
});

// Every other case here seeds localStorage before mount, so the list mirror is filled by its lazy
// initialiser. Only the add path exercises the mirror write itself: without it the new connection
// would name the trigger yet be missing from the dropdown it was selected from, and so could never
// be edited or deleted.
it('lists a newly added connection as a dropdown row', async () => {
    const passingTests: ConnectionStatus[] = [
        { status: ConnectionTestStates.OK, message: 'SSH connection established' },
        { status: ConnectionTestStates.OK, message: 'Found 3 memory reports' },
    ];
    const addedName = 'Added Server';

    const axiosInstance = await import('../src/libs/axiosInstance');
    vi.mocked(axiosInstance.default.post).mockImplementation((url: string) => {
        if (url === `${Endpoints.REMOTE}/test`) {
            return Promise.resolve({ data: passingTests } as AxiosResponse);
        }

        return Promise.resolve({ status: 204, data: '' } as AxiosResponse);
    });

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    fireEvent.click(getButtonWithText(ADD_NEW_CONNECTION));
    fireEvent.change(screen.getByLabelText(CONNECTION_NAME_LABEL), { target: { value: addedName } });
    fireEvent.change(screen.getByLabelText(SSH_HOST_LABEL), { target: { value: 'added.example.com' } });
    fireEvent.change(screen.getByLabelText(SSH_USERNAME_LABEL), { target: { value: 'prod-user' } });
    fireEvent.change(screen.getByLabelText(REMOTE_MEMORY_PATH_LABEL), { target: { value: '/opt/reports' } });
    fireEvent.click(getButtonWithText('Run tests'));

    await waitFor(() => expect(getButtonWithText('Add connection')).toBeEnabled(), WAIT_FOR_OPTIONS);
    fireEvent.click(getButtonWithText('Add connection'));

    const trigger = await screen.findByRole('button', { name: new RegExp(addedName) }, WAIT_FOR_OPTIONS);
    trigger.click();

    // Waiting on a portal would be vacuous here: the dialog just dismissed is still running its exit
    // transition, so its portal satisfies the check while the dropdown's own portal — which Blueprint
    // only fills on a passive effect, a tick after the trigger reports itself open — is still empty.
    const rows = await screen.findAllByTestId(TEST_IDS.REMOTE_CONNECTION_ROW, undefined, WAIT_FOR_OPTIONS);

    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain(addedName);
});

// The folder caches are keyed by name|host|port, so editing the host moves them.
// updateSavedRemoteFoldersConnection is the only thing carrying them across, and asserting
// only on the connection list would stay green if that call were dropped.
it('moves cached folder lists when an edit changes the host', async () => {
    const editedHost = 'moved.example.com';
    // Editing the *unselected* connection keeps the folder-fetch path out of it: re-pointing the
    // selection refetches and would overwrite the moved cache with the mocked empty response,
    // hiding whether the move happened at all.
    const original: RemoteConnection = {
        name: 'Other Server',
        username: 'prod-user',
        host: 'other.example.com',
        port: 22,
        profilerPath: '/opt/reports',
        performancePath: '/opt/perf',
    };
    const cachedReportFolders = [{ remotePath: '/reports/cached', reportName: 'cached', lastModified: 1 }];
    const cachedPerformanceFolders = [{ remotePath: '/perf/cached', reportName: 'cached-perf', lastModified: 2 }];

    const axiosInstance = await import('../src/libs/axiosInstance');
    const mockPost = vi.mocked(axiosInstance.default.post);

    setupConnection([remoteConnection[0], original], remoteConnection[0]);
    window.localStorage.setItem(savedReportFoldersKey(original), JSON.stringify(cachedReportFolders));
    window.localStorage.setItem(savedPerformanceFoldersKey(original), JSON.stringify(cachedPerformanceFolders));

    mockPost.mockImplementation((url: string) => {
        if (url === `${Endpoints.REMOTE}/test`) {
            return Promise.resolve({
                data: [
                    { status: ConnectionTestStates.OK, message: 'SSH connection established' },
                    { status: ConnectionTestStates.OK, message: 'Found 3 memory reports' },
                ] as ConnectionStatus[],
            } as AxiosResponse);
        }

        return Promise.resolve({ status: 204, data: '' } as AxiosResponse);
    });

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    getButtonWithText(CONNECTION_NAME).click();
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);

    fireEvent.click(screen.getByLabelText(getEditConnectionLabel(original)));
    fireEvent.change(screen.getByLabelText(SSH_HOST_LABEL), { target: { value: editedHost } });
    fireEvent.click(getButtonWithText('Run tests'));

    await waitFor(() => expect(getButtonWithText('Save connection')).toBeEnabled(), WAIT_FOR_OPTIONS);
    fireEvent.click(getButtonWithText('Save connection'));

    const movedConnection: RemoteConnection = { ...original, host: editedHost };

    await waitFor(() => {
        expect(window.localStorage.getItem(savedReportFoldersKey(movedConnection))).toBe(
            JSON.stringify(cachedReportFolders),
        );
    }, WAIT_FOR_OPTIONS);

    expect(window.localStorage.getItem(savedPerformanceFoldersKey(movedConnection))).toBe(
        JSON.stringify(cachedPerformanceFolders),
    );
    expect(window.localStorage.getItem(savedReportFoldersKey(original))).toBeNull();
    expect(window.localStorage.getItem(savedPerformanceFoldersKey(original))).toBeNull();
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
    window.localStorage.setItem(savedPerformanceFoldersKey(remoteConnection[0]), JSON.stringify([staleFolder]));

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
            JSON.parse(window.localStorage.getItem(savedPerformanceFoldersKey(remoteConnection[0])) ?? '[]'),
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

// Both the trigger and the dropdown rows read state mirrors of localStorage, so neither notices a
// write from outside this component. Pinned because the two used to disagree — the trigger read
// through to localStorage while the rows came from the mirror — which meant a connection could
// name the trigger while being absent from the list it was supposedly selected from. Retiring the
// mirrors for atomWithStorage should make both pick the write up, not just one.
it('ignores a connection written to localStorage by something other than this component', () => {
    window.localStorage.removeItem(LOCAL_STORAGE_KEY_CONNECTIONS);

    const { rerender } = render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    expect(getButtonWithText(NO_CONNECTION)).not.toBeNull();

    setupConnection(remoteConnection);

    rerender(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    expect(getButtonWithText(NO_CONNECTION)).not.toBeNull();
    expect(screen.queryAllByTestId(TEST_IDS.REMOTE_CONNECTION_ROW)).toHaveLength(0);
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

const MULTIHOST_ROOT = '/tt-metal/generated/profiler/ttrun';

const multihostConnection: RemoteConnection[] = [
    {
        name: 'Multihost',
        username: 'test-user',
        host: 'localhost',
        port: 2222,
        profilerPath: '',
        performancePath: MULTIHOST_ROOT,
        multihostPerformance: true,
    },
];

const TIMESTAMP = '2026_07_28_18_04_24';

/** As the SSH listing reports one rank: the server names the rank and the synced folder. */
const rankFolder = (rank: number, reportName = TIMESTAMP): RemoteFolder => ({
    reportName,
    remotePath: `${MULTIHOST_ROOT}/rank${rank}/reports/${reportName}`,
    lastModified: rank + 1,
    syncedName: `${reportName}_rank${rank}`,
    rank,
});

// Every rank of one launch names its report from its own start time at second
// granularity, so sharing a name is the normal case rather than the edge case.
const multihostFolders: RemoteFolder[] = [rankFolder(0), rankFolder(1)];

const renderPerformanceSelector = async (
    connectionList: RemoteConnection[],
    folderList: RemoteFolder[] = multihostFolders,
    onSelectFolder: (folder: RemoteFolder) => void = () => undefined,
) => {
    setupConnection(connectionList);

    render(
        <TestProviders>
            <RemoteFolderSelector
                remoteFolderList={folderList}
                onSelectFolder={onSelectFolder}
                type='performance'
            />
        </TestProviders>,
    );

    getButtonWithText(NO_SELECTION).click();
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);
};

it('tells apart ranks whose reports share a name', async () => {
    await renderPerformanceSelector(multihostConnection);

    expect(screen.getByText(`Rank 0: ${TIMESTAMP}`)).toBeTruthy();
    expect(screen.getByText(`Rank 1: ${TIMESTAMP}`)).toBeTruthy();
    // The rank folder and the intervening reports/ segment are no longer shown raw.
    expect(screen.queryByText(`/rank0/reports/${TIMESTAMP}`)).toBeNull();
});

it('hands back the rank that was clicked', async () => {
    const onSelectFolder = vi.fn();

    await renderPerformanceSelector(multihostConnection, multihostFolders, onSelectFolder);
    screen.getByText(`Rank 1: ${TIMESTAMP}`).click();

    expect(onSelectFolder).toHaveBeenCalledTimes(1);
    expect(onSelectFolder.mock.calls[0][0].remotePath).toBe(rankFolder(1).remotePath);
});

it('names the selected rank on the collapsed button', () => {
    // Otherwise the button reads the same for every rank of a launch and there is
    // no way to see which one is loaded.
    setupConnection(multihostConnection);

    render(
        <TestProviders>
            <RemoteFolderSelector
                remoteFolderList={multihostFolders}
                remoteFolder={rankFolder(1)}
                onSelectFolder={() => undefined}
                type='performance'
            />
        </TestProviders>,
    );

    expect(screen.getByTestId(TEST_IDS.REMOTE_FOLDER_SELECTOR_BUTTON).textContent).toContain(`Rank 1: ${TIMESTAMP}`);
});

it('leaves single-host performance labels as paths', async () => {
    const singleHostConnection: RemoteConnection[] = [{ ...multihostConnection[0], multihostPerformance: false }];
    const singleHostFolders: RemoteFolder[] = [
        {
            reportName: TIMESTAMP,
            remotePath: `${MULTIHOST_ROOT}/rank0/reports/${TIMESTAMP}`,
            lastModified: 1,
            syncedName: TIMESTAMP,
        },
    ];

    await renderPerformanceSelector(singleHostConnection, singleHostFolders);

    expect(screen.queryByText(`Rank 0: ${TIMESTAMP}`)).toBeNull();
    expect(screen.getByText(`/rank0/reports/${TIMESTAMP}`)).toBeTruthy();
});

it('labels an already-synced rank the same as the online listing', async () => {
    // The offline listing reports the local folder name, so both spellings of one
    // report have to read identically.
    const syncedFolders: RemoteFolder[] = [
        {
            reportName: TIMESTAMP,
            remotePath: `${MULTIHOST_ROOT}/${TIMESTAMP}_rank0`,
            lastModified: 1,
            syncedName: `${TIMESTAMP}_rank0`,
            rank: 0,
        },
    ];

    await renderPerformanceSelector(multihostConnection, syncedFolders);

    expect(screen.getByText(`Rank 0: ${TIMESTAMP}`)).toBeTruthy();
});

it('falls back to the path when the listing reported no rank', async () => {
    const folderWithoutRank: RemoteFolder[] = [
        {
            reportName: 'loose_report',
            remotePath: `${MULTIHOST_ROOT}/loose_report`,
            lastModified: 1,
            syncedName: 'loose_report',
        },
    ];

    await renderPerformanceSelector(multihostConnection, folderWithoutRank);

    expect(screen.getByText('/loose_report')).toBeTruthy();
});

/** Saving is gated on a passing connection test, so the edit has to run one. */
const editConnection = async (connection: RemoteConnection) => {
    const axiosInstance = await import('../src/libs/axiosInstance');

    vi.mocked(axiosInstance.default.post).mockImplementation((url: string) =>
        url.includes('/api/remote/test')
            ? Promise.resolve({
                  data: [{ status: ConnectionTestStates.OK, message: 'Connection OK' }],
              } as AxiosResponse)
            : Promise.resolve({ data: [] } as AxiosResponse),
    );

    // Edit is a per-row action inside the connection dropdown, so the row has to be on screen.
    fireEvent.click(getConnectionTrigger(connection));
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);
    fireEvent.click(screen.getByLabelText(getEditConnectionLabel(connection)));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: MULTIHOST_CHECKBOX_NAME })).toBeTruthy());
};

const runConnectionTestAndSave = async () => {
    fireEvent.click(getButtonWithText('Run tests'));

    await waitFor(() => expect(getButtonWithText('Save connection')).toHaveProperty(HTML_DISABLED, false), {
        ...WAIT_FOR_OPTIONS,
    });

    fireEvent.click(getButtonWithText('Save connection'));
};

it('drops cached performance folders when the multihost flag is flipped', async () => {
    // The cached rows are remote paths under the old layout, so keeping them would
    // offer reports the new search cannot find.
    const connection = { ...multihostConnection[0], multihostPerformance: false };
    const cacheKey = savedPerformanceFoldersKey(connection);

    setupConnection([connection]);
    window.localStorage.setItem(cacheKey, JSON.stringify(multihostFolders));

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    await editConnection(connection);
    fireEvent.click(screen.getByRole('checkbox', { name: MULTIHOST_CHECKBOX_NAME }));
    await runConnectionTestAndSave();

    await waitFor(() => expect(window.localStorage.getItem(cacheKey)).toBeNull(), WAIT_FOR_OPTIONS);
});

it('keeps cached performance folders when an unrelated field is edited', async () => {
    const connection = multihostConnection[0];
    const cacheKey = savedPerformanceFoldersKey(connection);

    setupConnection([connection]);
    window.localStorage.setItem(cacheKey, JSON.stringify(multihostFolders));

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    await editConnection(connection);
    // Not the name: the cache is keyed on it, so a rename moves the entry rather
    // than dropping it and the assertion below would pass for the wrong reason.
    fireEvent.change(screen.getByLabelText(REMOTE_MEMORY_PATH_LABEL), { target: { value: '/elsewhere' } });
    await runConnectionTestAndSave();

    await waitFor(
        () => expect(screen.queryByRole('checkbox', { name: MULTIHOST_CHECKBOX_NAME })).toBeNull(),
        WAIT_FOR_OPTIONS,
    );
    expect(window.localStorage.getItem(cacheKey)).not.toBeNull();
});

// TODO: Add more tests to cover remaining functionality and edge cases
// ❌ No test for clicking Edit button
// ❌ No test for clicking Remove button
// ❌ No test verifying error messages display
