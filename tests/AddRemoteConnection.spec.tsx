// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The add dialog stays mounted between opens, so what it holds on to after a save is only
 * visible from the button that opens it. Driven through the wrapper for that reason.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddRemoteConnection from '../src/components/report-selection/AddRemoteConnection';
import { ConnectionNameSubject, getNameTakenMessage } from '../src/definitions/ConnectionDialog';
import { ConnectionStatus, ConnectionTestStates } from '../src/definitions/ConnectionStatus';
import { RemoteConnection } from '../src/definitions/RemoteConnection';
import getButtonWithText from './helpers/getButtonWithText';
import { SshConfigHostsQueryResult, noSshConfigResult } from './helpers/sshConfigFixtures';

const { getServerConfigMock, SERVER_CONFIG } = vi.hoisted(() => {
    const config = {
        SSH_DEFAULT_PORT: 2222,
        SSH_DEFAULT_PROFILER_PATH: '/mem',
        SSH_DEFAULT_PERFORMANCE_PATH: '/perf',
        USERNAME: 'bob',
        SERVER_MODE: false,
    };

    return { getServerConfigMock: vi.fn(() => config), SERVER_CONFIG: config };
});

const useSshConfigHostsMock = vi.hoisted(() => vi.fn<(enabled?: boolean) => SshConfigHostsQueryResult>());
const testConnectionMock = vi.hoisted(() => vi.fn<() => Promise<ConnectionStatus[]>>());

vi.mock('../src/functions/getServerConfig', () => ({ default: getServerConfigMock }));
vi.mock('../src/hooks/useSshConfigHosts', () => ({ default: useSshConfigHostsMock }));
vi.mock('../src/hooks/useRemote', () => ({ default: () => ({ testConnection: testConnectionMock }) }));

const PASSING_TESTS: ConnectionStatus[] = [
    { status: ConnectionTestStates.OK, message: 'SSH connection established' },
    { status: ConnectionTestStates.OK, message: 'Found 3 memory reports' },
];

const CONNECTION_NAME = 'Worker';
const ADD_BUTTON = 'Add new connection';
const SAVE_BUTTON = 'Add connection';

afterEach(() => {
    cleanup();
});

beforeEach(() => {
    getServerConfigMock.mockClear();
    getServerConfigMock.mockReturnValue(SERVER_CONFIG);
    useSshConfigHostsMock.mockClear();
    useSshConfigHostsMock.mockReturnValue(noSshConfigResult());
    testConnectionMock.mockClear();
    testConnectionMock.mockResolvedValue(PASSING_TESTS);
});

/** Keeps the saved list the way the real parent does, so the second open sees the first save. */
const AddRemoteConnectionHarness = () => {
    const [connections, setConnections] = useState<RemoteConnection[]>([]);

    return (
        <AddRemoteConnection
            disabled={false}
            connectionList={connections}
            onAddConnection={(connection) => setConnections([...connections, connection])}
        />
    );
};

const addConnection = async (name: string) => {
    fireEvent.click(getButtonWithText(ADD_BUTTON));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
    fireEvent.change(screen.getByLabelText('SSH Host'), { target: { value: 'worker-01' } });
    fireEvent.click(getButtonWithText('Run tests'));
    await waitFor(() => expect(getButtonWithText(SAVE_BUTTON)).toBeEnabled());
    fireEvent.click(getButtonWithText(SAVE_BUTTON));
};

describe('AddRemoteConnection', () => {
    it('opens a clean form after a connection has been added', async () => {
        render(<AddRemoteConnectionHarness />);

        await addConnection(CONNECTION_NAME);
        fireEvent.click(getButtonWithText(ADD_BUTTON));

        // Carrying the values over would also carry the name, which the list now holds —
        // so the dialog would open reporting the connection just saved as a duplicate.
        expect(screen.getByLabelText('Name')).toHaveValue('');
        expect(screen.getByLabelText('SSH Host')).toHaveValue('');
        expect(screen.queryByRole('group', { name: 'Test Connection' })).not.toBeInTheDocument();
        expect(getButtonWithText(SAVE_BUTTON)).toBeDisabled();
    });

    it('reports the saved connection as a duplicate when its name is entered again', async () => {
        render(<AddRemoteConnectionHarness />);

        await addConnection(CONNECTION_NAME);
        fireEvent.click(getButtonWithText(ADD_BUTTON));
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: CONNECTION_NAME } });

        // Pins the wiring as well as the check: the dialog only sees the saved list because
        // this wrapper forwards it, and nothing else would notice if it stopped.
        expect(
            screen.getByText(getNameTakenMessage(ConnectionNameSubject.CONNECTION, CONNECTION_NAME)),
        ).toBeInTheDocument();
        expect(getButtonWithText(SAVE_BUTTON)).toBeDisabled();
    });
});
