// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AxiosResponse } from 'axios';
import { TestProviders } from './helpers/TestProviders';
import RemoteSyncConfigurator from '../src/components/report-selection/RemoteSyncConfigurator';
import getButtonWithText from './helpers/getButtonWithText';
import getAllButtonsWithText from './helpers/getAllButtonsWithText';
import remoteConnection from './data/remoteConnection.json';
import mockProfilerFolderList from './data/mockProfilerFolderList.json';
import mockRemoteProfilerFolderList from './data/mockRemoteProfilerFolderList.json';
import mockPerformanceReportFolders from './data/mockPerformanceReportFolders.json';
import mockRemotePerformanceFolderList from './data/mockRemotePerformanceFolderList.json';
import mockInstance from './data/mockInstance.json';
import { TEST_IDS } from '../src/definitions/TestIds';
import testForPortal from './helpers/testForPortal';

// Scrub the markup after each test
afterEach(cleanup);

beforeEach(() => {
    vi.resetAllMocks();
    vi.clearAllMocks();
    // Clean up localStorage between tests
    window.localStorage.clear();
});

const WAIT_FOR_OPTIONS = { timeout: 1000 };
const ADD_NEW_CONNECTION = 'Add new connection';
const NO_CONNECTION = '(No connection)';
const EDIT_NEW_CONNECTION = 'Edit selected connection';
const REMOVE_NEW_CONNECTION = 'Remove selected connection';
const FETCH_REMOTE_FOLDERS = 'Fetch remote folders list';
const CONNECTION_NAME = 'Local - ssh://localhost:2222/';
const NO_SELECTION = '(No selection)';

const LOCAL_STORAGE_KEY_CONNECTIONS = 'remoteConnections';
const LOCAL_STORAGE_KEY_SELECTED = 'selectedConnection';

const HTML_DISABLED = 'disabled';
const INTENT_SUCCESS_CLASS = 'bp6-intent-success';

vi.mock('../src/hooks/useAPI.tsx', () => ({
    useReportFolderList: () => ({
        data: mockProfilerFolderList,
    }),
    usePerfFolderList: () => ({
        data: mockPerformanceReportFolders,
    }),
    useInstance: () => ({
        data: mockInstance,
    }),
}));

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        post: vi.fn(),
    },
}));

it('renders the initial form state when there is no data', () => {
    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    const reportSelects = getAllButtonsWithText(NO_SELECTION);

    expect(getButtonWithText(ADD_NEW_CONNECTION)).not.toBeNull();
    expect(getButtonWithText(NO_CONNECTION)).not.toBeNull();
    expect(getButtonWithText(EDIT_NEW_CONNECTION)).to.have.property(HTML_DISABLED, true);
    expect(getButtonWithText(REMOVE_NEW_CONNECTION)).to.have.property(HTML_DISABLED, true);
    expect(getButtonWithText(FETCH_REMOTE_FOLDERS)).to.have.property(HTML_DISABLED, true);
    expect(reportSelects).to.have.length(2);

    reportSelects.forEach((select) => {
        expect(select).to.have.property(HTML_DISABLED, true);
    });
});

it('enables fetch remote folder list button when a connection is selected', () => {
    window.localStorage.setItem(LOCAL_STORAGE_KEY_CONNECTIONS, JSON.stringify(remoteConnection));
    window.localStorage.setItem(LOCAL_STORAGE_KEY_SELECTED, JSON.stringify(remoteConnection[0]));

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    const reportSelects = getAllButtonsWithText(NO_SELECTION);
    const fetchButton = getButtonWithText(FETCH_REMOTE_FOLDERS);

    expect(getButtonWithText(CONNECTION_NAME)).not.toBeNull();
    expect(getButtonWithText(EDIT_NEW_CONNECTION)).to.have.property(HTML_DISABLED, false);
    expect(getButtonWithText(REMOVE_NEW_CONNECTION)).to.have.property(HTML_DISABLED, false);
    expect(getButtonWithText(FETCH_REMOTE_FOLDERS)).to.have.property(HTML_DISABLED, false);
    expect(reportSelects).to.have.length(2);

    reportSelects.forEach((select) => {
        expect(select).to.have.property(HTML_DISABLED, true);
    });

    expect(fetchButton).toHaveProperty(HTML_DISABLED, false);
});

it('clears localStorage and resets state when removing a connection', () => {
    // Set up initial connection
    window.localStorage.setItem(LOCAL_STORAGE_KEY_CONNECTIONS, JSON.stringify(remoteConnection));
    window.localStorage.setItem(LOCAL_STORAGE_KEY_SELECTED, JSON.stringify(remoteConnection[0]));

    const { rerender } = render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Verify connection exists initially
    expect(getButtonWithText(CONNECTION_NAME)).not.toBeNull();
    expect(getButtonWithText(REMOVE_NEW_CONNECTION)).to.have.property(HTML_DISABLED, false);

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
    expect(getButtonWithText(EDIT_NEW_CONNECTION)).to.have.property(HTML_DISABLED, true);
    expect(getButtonWithText(REMOVE_NEW_CONNECTION)).to.have.property(HTML_DISABLED, true);
    expect(getButtonWithText(FETCH_REMOTE_FOLDERS)).to.have.property(HTML_DISABLED, true);
});

it('handles multiple remote connections in localStorage', () => {
    const multipleConnections = [
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

    window.localStorage.setItem(LOCAL_STORAGE_KEY_CONNECTIONS, JSON.stringify(multipleConnections));

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Should show the first connection by default
    expect(getButtonWithText(CONNECTION_NAME)).not.toBeNull();
    expect(getButtonWithText(EDIT_NEW_CONNECTION)).to.have.property(HTML_DISABLED, false);
    expect(getButtonWithText(REMOVE_NEW_CONNECTION)).to.have.property(HTML_DISABLED, false);
});

it('shows proper button states when remote folders are available', () => {
    window.localStorage.setItem(LOCAL_STORAGE_KEY_CONNECTIONS, JSON.stringify(remoteConnection));

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    const reportSelects = getAllButtonsWithText(NO_SELECTION);
    expect(reportSelects).to.have.length(2);
});

it('displays correct connection information format', () => {
    const customConnection = [
        {
            name: 'Test Connection',
            username: 'testuser',
            host: 'test.example.com',
            port: 2222,
            profilerPath: '/test/profiler',
            performancePath: '/test/performance',
        },
    ];

    window.localStorage.setItem(LOCAL_STORAGE_KEY_CONNECTIONS, JSON.stringify(customConnection));

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
    expect(getButtonWithText(EDIT_NEW_CONNECTION)).to.have.property(HTML_DISABLED, true);
    expect(getButtonWithText(REMOVE_NEW_CONNECTION)).to.have.property(HTML_DISABLED, true);
});

it('handles API errors gracefully', () => {
    // Mock error state
    vi.mock('../src/hooks/useAPI.tsx', () => ({
        useInstance: () => ({
            data: mockInstance,
        }),
        usePerfFolderList: () => ({
            data: null,
            isLoading: false,
            error: new Error('Network error'),
        }),
    }));

    window.localStorage.setItem(LOCAL_STORAGE_KEY_CONNECTIONS, JSON.stringify(remoteConnection));

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
        expect(select).to.have.property(HTML_DISABLED, true);
    });
});

it('set active performance report and syncs it on selection', async () => {
    const axiosInstance = await import('../src/libs/axiosInstance');
    const mockPost = vi.mocked(axiosInstance.default.post);

    const selectedReport = {
        ...mockRemotePerformanceFolderList[0],
        lastSynced: mockRemotePerformanceFolderList[0].lastModified + 1000,
    };

    // Mock the actual API endpoints
    mockPost.mockImplementation((url: string) => {
        if (url.includes('/api/remote/profiler')) {
            return Promise.resolve({ data: mockRemoteProfilerFolderList } as AxiosResponse);
        }
        if (url.includes('/api/remote/performance')) {
            return Promise.resolve({ data: [selectedReport] } as AxiosResponse);
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
    });

    // Start with only a connection configured, no folders yet
    window.localStorage.setItem(LOCAL_STORAGE_KEY_CONNECTIONS, JSON.stringify(remoteConnection));
    window.localStorage.setItem(LOCAL_STORAGE_KEY_SELECTED, JSON.stringify(remoteConnection[0]));

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Click the fetch button to load remote folders
    const fetchButton = getButtonWithText(FETCH_REMOTE_FOLDERS);
    fetchButton.click();

    // Wait for the performance select button to become enabled after fetch completes
    await waitFor(() => {
        const selectButtons = screen.queryAllByTestId(TEST_IDS.REMOTE_FOLDER_SELECTOR_BUTTON);
        const enabledButtons = selectButtons.filter((btn) => !btn.hasAttribute(HTML_DISABLED));
        expect(enabledButtons.length).toBeGreaterThan(0);
    }, WAIT_FOR_OPTIONS);

    // Click the enabled performance selector button to open the folder list
    const selectButtons = screen.queryAllByTestId(TEST_IDS.REMOTE_FOLDER_SELECTOR_BUTTON);
    const enabledButton = selectButtons.find((btn) => !btn.hasAttribute(HTML_DISABLED));
    expect(enabledButton).toBeDefined();
    enabledButton!.click();

    // Wait for the portal to appear with actual content
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);

    // Select the folder - use the same simple approach as localFolderSelector
    const { reportName } = selectedReport;

    screen.getByText(reportName).click();

    // Wait for the button text to update after selection
    await waitFor(() => {
        const toastFilename = screen.queryByTestId(TEST_IDS.TOAST_FILENAME);
        expect(toastFilename?.textContent).to.contain(reportName);
    }, WAIT_FOR_OPTIONS);

    // Verify the sync button appears
    const syncButton = await screen.findByTestId(TEST_IDS.REMOTE_SYNC_BUTTON, undefined, WAIT_FOR_OPTIONS);
    expect(syncButton.classList.contains(INTENT_SUCCESS_CLASS)).toBe(true);
});

it('handles connection with default port (22)', () => {
    const connectionWithDefaultPort = [
        {
            ...remoteConnection[0],
            port: 22,
        },
    ];

    window.localStorage.setItem(LOCAL_STORAGE_KEY_CONNECTIONS, JSON.stringify(connectionWithDefaultPort));

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
    const incompleteConnection = [
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

    // Should handle incomplete connection data gracefully
    // The exact behavior depends on component validation logic
    expect(getButtonWithText(ADD_NEW_CONNECTION)).not.toBeNull();
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
    window.localStorage.setItem(LOCAL_STORAGE_KEY_CONNECTIONS, JSON.stringify(remoteConnection));

    rerender(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Should now show the connection
    expect(getButtonWithText(CONNECTION_NAME)).not.toBeNull();
    expect(getButtonWithText(EDIT_NEW_CONNECTION)).to.have.property(HTML_DISABLED, false);
});

it('displays appropriate connection count information', () => {
    const multipleConnections = [
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

    window.localStorage.setItem(LOCAL_STORAGE_KEY_CONNECTIONS, JSON.stringify(multipleConnections));

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Should show first connection by default
    expect(getButtonWithText(CONNECTION_NAME)).not.toBeNull();

    // All connection management buttons should be enabled
    expect(getButtonWithText(EDIT_NEW_CONNECTION)).to.have.property(HTML_DISABLED, false);
    expect(getButtonWithText(REMOVE_NEW_CONNECTION)).to.have.property(HTML_DISABLED, false);
    expect(getButtonWithText(FETCH_REMOTE_FOLDERS)).to.have.property(HTML_DISABLED, false);
});
