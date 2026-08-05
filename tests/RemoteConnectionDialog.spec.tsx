// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RemoteConnectionDialog from '../src/components/report-selection/RemoteConnectionDialog';
import { ConnectionStatus, ConnectionTestStates } from '../src/definitions/ConnectionStatus';
import { RemoteConnection } from '../src/definitions/RemoteConnection';
import { SSH_CONFIG_HOST_LABEL } from '../src/definitions/SshConfigHostPicker';
import { SSH_IDENTITY_FILE_LABEL } from '../src/definitions/SshConnectionFields';
import getButtonWithText from './helpers/getButtonWithText';
import { SshConfigHostsQueryResult, noSshConfigResult, sshConfigHostsResult } from './helpers/sshConfigFixtures';
import { ExistingTarget, describeSshConfigPrefillContract } from './helpers/sshConfigPrefillContract';

// Declared inside the hoisted factory: it runs before module-scope consts initialise.
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

vi.mock('../src/functions/getServerConfig', () => ({
    default: getServerConfigMock,
}));

vi.mock('../src/hooks/useSshConfigHosts', () => ({
    default: useSshConfigHostsMock,
}));

vi.mock('../src/hooks/useRemote', () => ({
    default: () => ({
        testConnection: testConnectionMock,
    }),
}));

afterEach(() => {
    cleanup();
});

beforeEach(() => {
    getServerConfigMock.mockClear();
    getServerConfigMock.mockReturnValue(SERVER_CONFIG);
    useSshConfigHostsMock.mockClear();
    useSshConfigHostsMock.mockReturnValue(noSshConfigResult());
    testConnectionMock.mockClear();
    testConnectionMock.mockResolvedValue([]);
});

describe('RemoteConnectionDialog defaults', () => {
    it('seeds add-connection fields from getServerConfig', () => {
        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        expect(screen.getByLabelText('SSH Port')).toHaveValue('2222');
        expect(screen.getByLabelText('Memory report folder path')).toHaveValue('/mem');
        expect(screen.getByLabelText('Performance report folder path')).toHaveValue('/perf');
        expect(screen.getByLabelText('Username')).toHaveValue('bob');
    });

    it('treats a missing performancePath on edit as an empty controlled input', () => {
        const remoteConnection = {
            name: 'c',
            host: 'h',
            port: 22,
            username: 'u',
            profilerPath: '/p',
        } as RemoteConnection;

        render(
            <RemoteConnectionDialog
                open
                remoteConnection={remoteConnection}
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        expect(screen.getByLabelText('Performance report folder path')).toHaveValue('');
    });
});

const PASSING_TESTS: ConnectionStatus[] = [
    { status: ConnectionTestStates.OK, message: 'SSH connection established' },
    { status: ConnectionTestStates.OK, message: 'Memory report folder path exists' },
];

const renderRemoteConnectionDialog = ({ open = true, existing }: { open?: boolean; existing?: ExistingTarget } = {}) =>
    render(
        <RemoteConnectionDialog
            open={open}
            remoteConnection={
                existing && {
                    name: existing.name,
                    host: existing.host,
                    username: existing.username,
                    port: 22,
                    profilerPath: '/mem',
                }
            }
            onClose={vi.fn()}
            onAddConnection={vi.fn()}
        />,
    );

describeSshConfigPrefillContract('RemoteConnectionDialog', {
    renderDialog: renderRemoteConnectionDialog,
    hostLabel: 'SSH Host',
    sshPortLabel: 'SSH Port',
    runTestsLabel: 'Run tests',
    saveLabel: 'Add connection',
    passingTestMessage: 'SSH connection established',
    invalidatedTestMessage: 'Check SSH connection is valid',
    useSshConfigHostsMock,
    setServerMode: (serverMode) => getServerConfigMock.mockReturnValue({ ...SERVER_CONFIG, SERVER_MODE: serverMode }),
    mockPassingTest: () => testConnectionMock.mockResolvedValue(PASSING_TESTS),
    defaultUsername: SERVER_CONFIG.USERNAME,
});

// Behaviour specific to this dialog; the rest of the prefill contract is asserted above.
describe('RemoteConnectionDialog SSH config prefill specifics', () => {
    it('keeps a connection name the user already chose', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu', user: 'alice' }]));

        render(
            <RemoteConnectionDialog
                open
                remoteConnection={{
                    name: 'my lab box',
                    host: 'old-host',
                    port: 22,
                    username: 'bob',
                    profilerPath: '/mem',
                }}
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        fireEvent.change(screen.getByLabelText(SSH_CONFIG_HOST_LABEL), { target: { value: 'work-gpu' } });

        expect(screen.getByLabelText('Name')).toHaveValue('my lab box');
        expect(screen.getByLabelText('SSH Host')).toHaveValue('work-gpu');
    });

    it('keeps the existing username when the config host has no User', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'bare-host', port: 45985 }]));

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        fireEvent.change(screen.getByLabelText(SSH_CONFIG_HOST_LABEL), { target: { value: 'bare-host' } });

        expect(screen.getByLabelText('Username')).toHaveValue('bob');
        expect(screen.getByLabelText('SSH Host')).toHaveValue('bare-host');
        expect(screen.getByLabelText('Name')).toHaveValue('bare-host');
        expect(screen.getByLabelText('SSH Port')).toHaveValue('45985');
    });
});

describe('RemoteConnectionDialog connection test invalidation', () => {
    it.each([
        ['SSH Host', 'other-host'],
        ['Username', 'carol'],
        ['SSH Port', '2022'],
        ['Memory report folder path', '/elsewhere'],
        ['Performance report folder path', '/elsewhere-perf'],
        [SSH_IDENTITY_FILE_LABEL, '/tmp/id_ed25519'],
    ])('discards a passing test result when %s is edited by hand', async (label, value) => {
        testConnectionMock.mockResolvedValue(PASSING_TESTS);

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        fireEvent.change(screen.getByLabelText('SSH Host'), { target: { value: 'work-gpu' } });
        fireEvent.click(getButtonWithText('Run tests'));
        await waitFor(() => expect(getButtonWithText('Add connection')).toBeEnabled());

        fireEvent.change(screen.getByLabelText(label), { target: { value } });

        expect(screen.queryByText('SSH connection established')).not.toBeInTheDocument();
        expect(getButtonWithText('Add connection')).toBeDisabled();
    });

    it('keeps a passing test result when only the connection name changes', async () => {
        testConnectionMock.mockResolvedValue(PASSING_TESTS);

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        fireEvent.click(getButtonWithText('Run tests'));
        await waitFor(() => expect(getButtonWithText('Add connection')).toBeEnabled());

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'my lab box' } });

        expect(screen.getByText('SSH connection established')).toBeInTheDocument();
        expect(getButtonWithText('Add connection')).toBeEnabled();
    });

    it('saves the prefilled connection without an identity file', async () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu', user: 'alice', port: 2222 }]));
        testConnectionMock.mockResolvedValue(PASSING_TESTS);
        const onAddConnection = vi.fn();

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={onAddConnection}
            />,
        );

        fireEvent.change(screen.getByLabelText(SSH_CONFIG_HOST_LABEL), { target: { value: 'work-gpu' } });
        fireEvent.click(getButtonWithText('Run tests'));
        await waitFor(() => expect(getButtonWithText('Add connection')).toBeEnabled());

        fireEvent.click(getButtonWithText('Add connection'));

        expect(onAddConnection).toHaveBeenCalledTimes(1);
        expect(onAddConnection.mock.calls[0][0]).toMatchObject({
            host: 'work-gpu',
            name: 'work-gpu',
            username: 'alice',
            port: 2222,
        });
        expect((onAddConnection.mock.calls[0][0] as RemoteConnection).identityFile).toBeUndefined();
    });
});
