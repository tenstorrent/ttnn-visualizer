// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RemoteConnectionDialog from '../src/components/report-selection/RemoteConnectionDialog';
import { ConnectionStatus, ConnectionTestStates } from '../src/definitions/ConnectionStatus';
import { RemoteConnection } from '../src/definitions/RemoteConnection';
import { SSH_CONFIG_HOST_CUSTOM, SSH_CONFIG_HOST_LABEL } from '../src/definitions/SshConfigHostPicker';
import getButtonWithText from './helpers/getButtonWithText';
import { SshConfigHostsQueryResult, noSshConfigResult, sshConfigHostsResult } from './helpers/sshConfigFixtures';

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

describe('RemoteConnectionDialog SSH config prefill', () => {
    it('prefills host, username, and port from a config host and clears identity', () => {
        useSshConfigHostsMock.mockReturnValue(
            sshConfigHostsResult([{ host: 'work-gpu', user: 'alice', port: 2222, hostName: 'gpu.example.com' }]),
        );

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        fireEvent.change(screen.getByLabelText('SSH identity file (optional)'), {
            target: { value: '/tmp/id_ed25519' },
        });
        fireEvent.change(screen.getByLabelText(SSH_CONFIG_HOST_LABEL), { target: { value: 'work-gpu' } });

        expect(screen.getByLabelText('Name')).toHaveValue('work-gpu');
        expect(screen.getByLabelText('SSH Host')).toHaveValue('work-gpu');
        expect(screen.getByLabelText('Username')).toHaveValue('alice');
        expect(screen.getByLabelText('SSH Port')).toHaveValue('2222');
        expect(screen.getByLabelText('SSH identity file (optional)')).toHaveValue('');
    });

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

    it('resets the picker to Custom when the host is typed by hand', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu', user: 'alice' }]));

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        const picker = screen.getByLabelText(SSH_CONFIG_HOST_LABEL) as HTMLSelectElement;
        fireEvent.change(picker, { target: { value: 'work-gpu' } });
        expect(picker.value).toBe('work-gpu');

        fireEvent.change(screen.getByLabelText('SSH Host'), { target: { value: 'typed-host' } });

        expect(picker.value).toBe(SSH_CONFIG_HOST_CUSTOM);
        expect(screen.getByLabelText('SSH Host')).toHaveValue('typed-host');
    });

    it('hides the SSH config host picker under SERVER_MODE', () => {
        getServerConfigMock.mockReturnValue({ ...SERVER_CONFIG, SERVER_MODE: true });
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'should-not-show' }]));

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        expect(screen.queryByLabelText(SSH_CONFIG_HOST_LABEL)).not.toBeInTheDocument();
    });

    it('gates the config-host fetch on the dialog being open', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu' }]));
        const props = { onClose: vi.fn(), onAddConnection: vi.fn() };

        const { unmount } = render(
            <RemoteConnectionDialog
                open={false}
                {...props}
            />,
        );

        // Blueprint unmounts the dialog body when closed, so nothing reads ~/.ssh/config;
        // enabled={open} keeps the fetch gated if the picker is ever rendered outside it.
        expect(useSshConfigHostsMock).not.toHaveBeenCalled();
        unmount();

        render(
            <RemoteConnectionDialog
                open
                {...props}
            />,
        );

        expect(useSshConfigHostsMock).toHaveBeenLastCalledWith(true);
    });

    it('discards a prefill the user backed out of', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu', user: 'alice', port: 2222 }]));
        const onClose = vi.fn();

        render(
            <RemoteConnectionDialog
                open
                onClose={onClose}
                onAddConnection={vi.fn()}
            />,
        );

        fireEvent.change(screen.getByLabelText(SSH_CONFIG_HOST_LABEL), { target: { value: 'work-gpu' } });
        expect(screen.getByLabelText('SSH Host')).toHaveValue('work-gpu');

        fireEvent.click(screen.getByRole('button', { name: 'Close' }));

        // The dialog stays mounted while closed, so this reset is the only thing keeping
        // a cancelled prefill from reappearing the next time it opens.
        expect(onClose).toHaveBeenCalledOnce();
        expect(screen.getByLabelText('SSH Host')).toHaveValue('');
        expect(screen.getByLabelText('Username')).toHaveValue('bob');
        expect(screen.getByLabelText('Name')).toHaveValue('');
        expect((screen.getByLabelText(SSH_CONFIG_HOST_LABEL) as HTMLSelectElement).value).toBe(SSH_CONFIG_HOST_CUSTOM);
    });

    it('restores the edited connection, not the defaults, when an edit is backed out of', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu', user: 'alice' }]));

        render(
            <RemoteConnectionDialog
                open
                remoteConnection={{
                    name: 'my lab box',
                    host: 'old-host',
                    port: 22,
                    username: 'carol',
                    profilerPath: '/mem',
                }}
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        fireEvent.change(screen.getByLabelText(SSH_CONFIG_HOST_LABEL), { target: { value: 'work-gpu' } });
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(screen.getByLabelText('SSH Host')).toHaveValue('old-host');
        expect(screen.getByLabelText('Username')).toHaveValue('carol');
    });

    it('hides the SSH config host picker when ~/.ssh/config does not exist', () => {
        useSshConfigHostsMock.mockReturnValue(noSshConfigResult());

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        expect(screen.queryByLabelText(SSH_CONFIG_HOST_LABEL)).not.toBeInTheDocument();
    });
});

describe('RemoteConnectionDialog connection test invalidation', () => {
    const PASSING_TESTS: ConnectionStatus[] = [
        { status: ConnectionTestStates.OK, message: 'SSH connection established' },
        { status: ConnectionTestStates.OK, message: 'Memory report folder path exists' },
    ];

    it('discards a passing test result when a config host changes the target', async () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu', user: 'alice' }]));
        testConnectionMock.mockResolvedValue(PASSING_TESTS);
        const onAddConnection = vi.fn();

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={onAddConnection}
            />,
        );

        fireEvent.click(getButtonWithText('Run tests'));
        await waitFor(() => expect(screen.getByText('SSH connection established')).toBeInTheDocument());
        expect(getButtonWithText('Add connection')).toBeEnabled();

        fireEvent.change(screen.getByLabelText(SSH_CONFIG_HOST_LABEL), { target: { value: 'work-gpu' } });

        expect(screen.queryByText('SSH connection established')).not.toBeInTheDocument();
        expect(screen.getByText('Check SSH connection is valid')).toBeInTheDocument();
        expect(getButtonWithText('Add connection')).toBeDisabled();
    });

    it.each([
        ['SSH Host', 'other-host'],
        ['Username', 'carol'],
        ['SSH Port', '2022'],
        ['Memory report folder path', '/elsewhere'],
        ['Performance report folder path', '/elsewhere-perf'],
        ['SSH identity file (optional)', '/tmp/id_ed25519'],
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
