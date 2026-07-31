// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ComponentProps } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import RemoteConnectionSelector from '../src/components/report-selection/RemoteConnectionSelector';
import { EDIT_CONNECTION_LABEL, REMOVE_CONNECTION_LABEL, RemoteConnection } from '../src/definitions/RemoteConnection';
import testForPortal from './helpers/testForPortal';
import { SshConfigHostsQueryResult, noSshConfigResult } from './helpers/sshConfigFixtures';

const { getServerConfigMock } = vi.hoisted(() => ({
    getServerConfigMock: vi.fn(() => ({
        SSH_DEFAULT_PORT: 2222,
        SSH_DEFAULT_PROFILER_PATH: '/mem',
        SSH_DEFAULT_PERFORMANCE_PATH: '/perf',
        USERNAME: 'bob',
        SERVER_MODE: false,
    })),
}));

const useSshConfigHostsMock = vi.hoisted(() => vi.fn<(enabled?: boolean) => SshConfigHostsQueryResult>());

vi.mock('../src/functions/getServerConfig', () => ({ default: getServerConfigMock }));
vi.mock('../src/hooks/useSshConfigHosts', () => ({ default: useSshConfigHostsMock }));
vi.mock('../src/hooks/useRemote', () => ({
    default: () => ({ testConnection: vi.fn().mockResolvedValue([]) }),
}));

const FIRST_CONNECTION: RemoteConnection = {
    name: 'First',
    username: 'tt',
    host: 'worker-01',
    port: 2222,
    profilerPath: '/mem',
};

const SECOND_CONNECTION: RemoteConnection = {
    name: 'Second',
    username: 'tt',
    host: 'worker-02',
    port: 2222,
    profilerPath: '/mem',
};

const WAIT_FOR_OPTIONS = { timeout: 1000 };

const renderSelector = (overrides: Partial<ComponentProps<typeof RemoteConnectionSelector>> = {}) => {
    const props = {
        connectionList: [FIRST_CONNECTION, SECOND_CONNECTION],
        connection: FIRST_CONNECTION,
        disabled: false,
        loading: false,
        onSelectConnection: vi.fn(),
        onEditConnection: vi.fn(),
        onRemoveConnection: vi.fn(),
        onSyncRemoteFolderList: vi.fn(),
        ...overrides,
    };

    render(<RemoteConnectionSelector {...props} />);

    return props;
};

/** Row actions only exist while the Select popover is open. */
const openConnectionDropdown = async () => {
    fireEvent.click(screen.getByRole('button', { name: /First - ssh/i }));
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);
};

afterEach(cleanup);

beforeEach(() => {
    useSshConfigHostsMock.mockClear();
    useSshConfigHostsMock.mockReturnValue(noSshConfigResult());
});

it('renders an edit and delete action on every connection row', async () => {
    renderSelector();
    await openConnectionDropdown();

    expect(screen.getAllByLabelText(EDIT_CONNECTION_LABEL)).toHaveLength(2);
    expect(screen.getAllByLabelText(REMOVE_CONNECTION_LABEL)).toHaveLength(2);
});

it('removes the connection whose row was clicked, not the selected one', async () => {
    const { onRemoveConnection } = renderSelector();
    await openConnectionDropdown();

    fireEvent.click(screen.getAllByLabelText(REMOVE_CONNECTION_LABEL)[1]);

    expect(screen.getByText(/Are you sure you want to delete the remote connection/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onRemoveConnection).toHaveBeenCalledTimes(1);
    expect(onRemoveConnection).toHaveBeenCalledWith(SECOND_CONNECTION);
});

it('does not remove anything when the delete is cancelled', async () => {
    const { onRemoveConnection } = renderSelector();
    await openConnectionDropdown();

    fireEvent.click(screen.getAllByLabelText(REMOVE_CONNECTION_LABEL)[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onRemoveConnection).not.toHaveBeenCalled();
});

it('warns that the cached report lists go with the connection', async () => {
    renderSelector();
    await openConnectionDropdown();

    fireEvent.click(screen.getAllByLabelText(REMOVE_CONNECTION_LABEL)[0]);

    expect(screen.getByText(/cached memory and performance report lists will be cleared/)).not.toBeNull();
});

it('seeds the edit dialog from the row that was clicked', async () => {
    renderSelector();
    await openConnectionDropdown();

    fireEvent.click(screen.getAllByLabelText(EDIT_CONNECTION_LABEL)[1]);

    expect(screen.getByText('Edit remote connection')).not.toBeNull();
    expect(screen.getByLabelText('Name')).toHaveValue(SECOND_CONNECTION.name);
    expect(screen.getByLabelText('SSH Host')).toHaveValue(SECOND_CONNECTION.host);
});

it('disables the row actions when the selector is disabled', () => {
    renderSelector({ disabled: true });

    // The trigger is disabled, so drive the popover open directly.
    fireEvent.click(screen.getByRole('button', { name: /First - ssh/i }));

    screen.queryAllByLabelText(EDIT_CONNECTION_LABEL).forEach((button) => expect(button).toBeDisabled());
    screen.queryAllByLabelText(REMOVE_CONNECTION_LABEL).forEach((button) => expect(button).toBeDisabled());
});
