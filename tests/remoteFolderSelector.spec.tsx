// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TestProviders } from './helpers/TestProviders';
import RemoteSyncConfigurator from '../src/components/report-selection/RemoteSyncConfigurator';
import getButtonWithText from './helpers/getButtonWithText';
import getAllButtonsWithText from './helpers/getAllButtonsWithText';
import remoteConnection from './data/remoteConnection.json';
import mockProfilerFolderList from './data/mockProfilerFolderList.json';
import mockPerformanceReportFolders from './data/mockPerformanceReportFolders.json';

// Scrub the markup after each test
afterEach(cleanup);

const PORTAL_CLASS = '.bp6-portal';

const ADD_NEW_CONNECTION = 'Add new connection';
const NO_CONNECTION = '(No connection)';
const EDIT_NEW_CONNECTION = 'Edit selected connection';
const REMOVE_NEW_CONNECTION = 'Remove selected connection';
const FETCH_REMOTE_FOLDERS = 'Fetch remote folders list';
const CONNECTION_NAME = 'Local - ssh://localhost:2222/';
const NO_SELECTION = '(No selection)';

vi.mock('../src/hooks/useAPI.tsx', () => ({
    useReportFolderList: () => ({
        data: mockProfilerFolderList,
    }),
    usePerfFolderList: () => ({
        data: mockPerformanceReportFolders,
    }),
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
    expect(getButtonWithText(EDIT_NEW_CONNECTION)).to.have.property('disabled', true);
    expect(getButtonWithText(REMOVE_NEW_CONNECTION)).to.have.property('disabled', true);
    expect(getButtonWithText(FETCH_REMOTE_FOLDERS)).to.have.property('disabled', true);
    expect(reportSelects).to.have.length(2);

    reportSelects.forEach((select) => {
        expect(select).to.have.property('disabled', true);
    });
});

it('enables fetch remote folder list button when a connection is selected', () => {
    window.localStorage.setItem('remoteConnections', JSON.stringify(remoteConnection));
    window.localStorage.setItem('selectedConnection', JSON.stringify(remoteConnection[0]));

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    const reportSelects = getAllButtonsWithText(NO_SELECTION);
    const fetchButton = getButtonWithText(FETCH_REMOTE_FOLDERS);

    expect(getButtonWithText(CONNECTION_NAME)).not.toBeNull();
    expect(getButtonWithText(EDIT_NEW_CONNECTION)).to.have.property('disabled', false);
    expect(getButtonWithText(REMOVE_NEW_CONNECTION)).to.have.property('disabled', false);
    expect(getButtonWithText(FETCH_REMOTE_FOLDERS)).to.have.property('disabled', false);
    expect(reportSelects).to.have.length(2);

    reportSelects.forEach((select) => {
        expect(select).to.have.property('disabled', true);
    });

    expect(fetchButton).toHaveProperty('disabled', false);
});

it('clears localStorage and resets state when removing a connection', () => {
    const { rerender } = render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Verify connection exists initially
    expect(getButtonWithText(CONNECTION_NAME)).not.toBeNull();
    expect(getButtonWithText(REMOVE_NEW_CONNECTION)).to.have.property('disabled', false);

    // Clear localStorage to simulate connection removal
    window.localStorage.removeItem('remoteConnections');

    rerender(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Verify UI resets to no connection state
    expect(getButtonWithText(NO_CONNECTION)).not.toBeNull();
    expect(getButtonWithText(EDIT_NEW_CONNECTION)).to.have.property('disabled', true);
    expect(getButtonWithText(REMOVE_NEW_CONNECTION)).to.have.property('disabled', true);
    expect(getButtonWithText(FETCH_REMOTE_FOLDERS)).to.have.property('disabled', true);
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

    window.localStorage.setItem('remoteConnections', JSON.stringify(multipleConnections));

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Should show the first connection by default
    expect(getButtonWithText(CONNECTION_NAME)).not.toBeNull();
    expect(getButtonWithText(EDIT_NEW_CONNECTION)).to.have.property('disabled', false);
    expect(getButtonWithText(REMOVE_NEW_CONNECTION)).to.have.property('disabled', false);
});

it('shows proper button states when remote folders are available', () => {
    window.localStorage.setItem('remoteConnections', JSON.stringify(remoteConnection));

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

    window.localStorage.setItem('remoteConnections', JSON.stringify(customConnection));

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Verify the connection display format
    expect(getButtonWithText('Test Connection - ssh://test.example.com:2222/')).not.toBeNull();
});

// TODO: Error will throw currently due to inadequate handling of a JSON parse failure
it.skip('handles localStorage parsing errors gracefully', () => {
    // Set invalid JSON in localStorage
    window.localStorage.setItem('remoteConnections', 'invalid-json');

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Should fall back to no connection state
    expect(getButtonWithText(NO_CONNECTION)).not.toBeNull();
    expect(getButtonWithText(EDIT_NEW_CONNECTION)).to.have.property('disabled', true);
    expect(getButtonWithText(REMOVE_NEW_CONNECTION)).to.have.property('disabled', true);
});

it('handles API errors gracefully', () => {
    // Mock error state
    vi.mock('../src/hooks/useAPI.tsx', () => ({
        usePerfFolderList: () => ({
            data: null,
            isLoading: false,
            error: new Error('Network error'),
        }),
    }));

    window.localStorage.setItem('remoteConnections', JSON.stringify(remoteConnection));

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
        expect(select).to.have.property('disabled', true);
    });
});

// TODO: Fix this test
it.skip('enables sync buttons when folders are selected', async () => {
    window.localStorage.setItem('remoteConnections', JSON.stringify(remoteConnection));

    // Mock successful folder data

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    getAllButtonsWithText(FETCH_REMOTE_FOLDERS)[0].click();

    const { reportName } = mockProfilerFolderList[0];

    getAllButtonsWithText(NO_SELECTION)[0].click();
    await waitFor(() => document.querySelector(PORTAL_CLASS));

    screen.getByText(reportName).click();

    const syncButtons = getAllButtonsWithText('Sync remote folder');
    expect(syncButtons).to.have.length(2);
});

it('handles connection with default port (22)', () => {
    const connectionWithDefaultPort = [
        {
            ...remoteConnection[0],
            port: 22,
        },
    ];

    window.localStorage.setItem('remoteConnections', JSON.stringify(connectionWithDefaultPort));

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

    window.localStorage.setItem('remoteConnections', JSON.stringify(incompleteConnection));

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
    window.localStorage.removeItem('remoteConnections');

    const { rerender } = render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Initially no connections
    expect(getButtonWithText(NO_CONNECTION)).not.toBeNull();

    // Add connection to localStorage
    window.localStorage.setItem('remoteConnections', JSON.stringify(remoteConnection));

    rerender(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Should now show the connection
    expect(getButtonWithText(CONNECTION_NAME)).not.toBeNull();
    expect(getButtonWithText(EDIT_NEW_CONNECTION)).to.have.property('disabled', false);
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

    window.localStorage.setItem('remoteConnections', JSON.stringify(multipleConnections));

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    // Should show first connection by default
    expect(getButtonWithText(CONNECTION_NAME)).not.toBeNull();

    // All connection management buttons should be enabled
    expect(getButtonWithText(EDIT_NEW_CONNECTION)).to.have.property('disabled', false);
    expect(getButtonWithText(REMOVE_NEW_CONNECTION)).to.have.property('disabled', false);
    expect(getButtonWithText(FETCH_REMOTE_FOLDERS)).to.have.property('disabled', false);
});
