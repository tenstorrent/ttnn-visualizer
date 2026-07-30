// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MlirServerDialog from '../src/components/report-selection/MlirServerDialog';
import { SshConfigHost, SshConfigHostsResponse } from '../src/model/SshConfigHost';

const getServerConfigMock = vi.hoisted(() =>
    vi.fn(() => ({
        SSH_DEFAULT_PORT: 2222,
        SSH_DEFAULT_PROFILER_PATH: '',
        SSH_DEFAULT_PERFORMANCE_PATH: '',
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

vi.mock('../src/hooks/useMlirRemote', () => ({
    default: () => ({
        testMlirServerConnection: vi.fn(),
    }),
}));

afterEach(() => {
    cleanup();
});

beforeEach(() => {
    getServerConfigMock.mockClear();
    getServerConfigMock.mockReturnValue({
        SSH_DEFAULT_PORT: 2222,
        SSH_DEFAULT_PROFILER_PATH: '',
        SSH_DEFAULT_PERFORMANCE_PATH: '',
        USERNAME: 'bob',
        SERVER_MODE: false,
    });
    useSshConfigHostsMock.mockClear();
    useSshConfigHostsMock.mockReturnValue({
        data: { configExists: false, hosts: [] },
        isError: false,
        isPending: false,
    });
});

describe('MlirServerDialog defaults', () => {
    it('seeds SSH port from getServerConfig', () => {
        render(
            <MlirServerDialog
                open
                onClose={vi.fn()}
                onAddServer={vi.fn()}
            />,
        );

        expect(screen.getByLabelText(/SSH Port/i)).toHaveValue('2222');
        expect(screen.getByLabelText('Username')).toHaveValue('bob');
    });
});

describe('MlirServerDialog SSH config prefill', () => {
    it('prefills host, name, username, and sshPort from a config host and clears identity', () => {
        useSshConfigHostsMock.mockReturnValue({
            data: { configExists: true, hosts: [{ host: 'work-gpu', user: 'alice', port: 2222 }] },
            isError: false,
            isPending: false,
        });

        render(
            <MlirServerDialog
                open
                server={{
                    name: 'old',
                    host: 'old-host',
                    sshPort: 22,
                    port: 8080,
                    username: 'bob',
                    identityFile: '/tmp/id_ed25519',
                }}
                onClose={vi.fn()}
                onAddServer={vi.fn()}
            />,
        );

        fireEvent.change(screen.getByLabelText('SSH config host'), { target: { value: 'work-gpu' } });

        expect(screen.getByLabelText('Name')).toHaveValue('work-gpu');
        expect(screen.getByLabelText('SSH host')).toHaveValue('work-gpu');
        expect(screen.getByLabelText('Username')).toHaveValue('alice');
        expect(screen.getByLabelText('SSH port')).toHaveValue('2222');
        expect(screen.getByLabelText('SSH identity file (optional)')).toHaveValue('');
    });

    it('hides the SSH config host picker under SERVER_MODE', () => {
        getServerConfigMock.mockReturnValue({
            SSH_DEFAULT_PORT: 2222,
            SSH_DEFAULT_PROFILER_PATH: '',
            SSH_DEFAULT_PERFORMANCE_PATH: '',
            USERNAME: 'bob',
            SERVER_MODE: true,
        });
        useSshConfigHostsMock.mockReturnValue({
            data: { configExists: true, hosts: [{ host: 'should-not-show' }] },
            isError: false,
            isPending: false,
        });

        render(
            <MlirServerDialog
                open
                onClose={vi.fn()}
                onAddServer={vi.fn()}
            />,
        );

        expect(screen.queryByLabelText('SSH config host')).not.toBeInTheDocument();
    });
});
