// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RemoteConnectionDialog from '../src/components/report-selection/RemoteConnectionDialog';
import { RemoteConnection } from '../src/definitions/RemoteConnection';
import { SshConfigHost, SshConfigHostsResponse } from '../src/model/SshConfigHost';

const emptySshConfigResponse = (): SshConfigHostsResponse => ({ configExists: false, hosts: [] });

const getServerConfigMock = vi.hoisted(() =>
    vi.fn(() => ({
        SSH_DEFAULT_PORT: 2222,
        SSH_DEFAULT_PROFILER_PATH: '/mem',
        SSH_DEFAULT_PERFORMANCE_PATH: '/perf',
        USERNAME: 'bob',
        SERVER_MODE: false,
    })),
);

const useSshConfigHostsMock = vi.hoisted(() =>
    vi.fn(() => ({
        data: { configExists: false, hosts: [] } as SshConfigHostsResponse,
        isError: false,
        isPending: false,
    })),
);

vi.mock('../src/functions/getServerConfig', () => ({
    default: getServerConfigMock,
}));

vi.mock('../src/hooks/useSshConfigHosts', () => ({
    default: useSshConfigHostsMock,
    getSshConfigHostLabel: (host: SshConfigHost) => (host.hostName ? `${host.host} — ${host.hostName}` : host.host),
}));

vi.mock('../src/hooks/useRemote', () => ({
    default: () => ({
        testConnection: vi.fn(),
    }),
}));

afterEach(() => {
    cleanup();
});

beforeEach(() => {
    getServerConfigMock.mockClear();
    getServerConfigMock.mockReturnValue({
        SSH_DEFAULT_PORT: 2222,
        SSH_DEFAULT_PROFILER_PATH: '/mem',
        SSH_DEFAULT_PERFORMANCE_PATH: '/perf',
        USERNAME: 'bob',
        SERVER_MODE: false,
    });
    useSshConfigHostsMock.mockClear();
    useSshConfigHostsMock.mockReturnValue({
        data: emptySshConfigResponse(),
        isError: false,
        isPending: false,
    });
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
    it('prefills host, name, username, and port from a config host and clears identity', () => {
        useSshConfigHostsMock.mockReturnValue({
            data: {
                configExists: true,
                hosts: [{ host: 'work-gpu', user: 'alice', port: 2222, hostName: 'gpu.example.com' }],
            },
            isError: false,
            isPending: false,
        });

        render(
            <RemoteConnectionDialog
                open
                remoteConnection={{
                    name: 'old',
                    host: 'old-host',
                    port: 22,
                    username: 'bob',
                    profilerPath: '/mem',
                    identityFile: '/tmp/id_ed25519',
                }}
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        expect(screen.getByLabelText('SSH identity file (optional)')).toHaveValue('/tmp/id_ed25519');

        fireEvent.change(screen.getByLabelText('SSH config host'), { target: { value: 'work-gpu' } });

        expect(screen.getByLabelText('Name')).toHaveValue('work-gpu');
        expect(screen.getByLabelText('SSH Host')).toHaveValue('work-gpu');
        expect(screen.getByLabelText('Username')).toHaveValue('alice');
        expect(screen.getByLabelText('SSH Port')).toHaveValue('2222');
        expect(screen.getByLabelText('SSH identity file (optional)')).toHaveValue('');
    });

    it('keeps the existing username when the config host has no User', () => {
        useSshConfigHostsMock.mockReturnValue({
            data: { configExists: true, hosts: [{ host: 'bare-host', port: 45985 }] },
            isError: false,
            isPending: false,
        });

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        fireEvent.change(screen.getByLabelText('SSH config host'), { target: { value: 'bare-host' } });

        expect(screen.getByLabelText('Username')).toHaveValue('bob');
        expect(screen.getByLabelText('SSH Host')).toHaveValue('bare-host');
        expect(screen.getByLabelText('Name')).toHaveValue('bare-host');
        expect(screen.getByLabelText('SSH Port')).toHaveValue('45985');
    });

    it('hides the SSH config host picker under SERVER_MODE', () => {
        getServerConfigMock.mockReturnValue({
            SSH_DEFAULT_PORT: 2222,
            SSH_DEFAULT_PROFILER_PATH: '/mem',
            SSH_DEFAULT_PERFORMANCE_PATH: '/perf',
            USERNAME: 'bob',
            SERVER_MODE: true,
        });
        useSshConfigHostsMock.mockReturnValue({
            data: { configExists: true, hosts: [{ host: 'should-not-show' }] },
            isError: false,
            isPending: false,
        });

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        expect(screen.queryByLabelText('SSH config host')).not.toBeInTheDocument();
    });

    it('hides the SSH config host picker when ~/.ssh/config does not exist', () => {
        useSshConfigHostsMock.mockReturnValue({
            data: emptySshConfigResponse(),
            isError: false,
            isPending: false,
        });

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        expect(screen.queryByLabelText('SSH config host')).not.toBeInTheDocument();
    });
});
