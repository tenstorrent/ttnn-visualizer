// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MlirServerDialog from '../src/components/report-selection/MlirServerDialog';
import { SshConfigHostsQueryResult, noSshConfigResult, sshConfigHostsResult } from './helpers/sshConfigFixtures';

const getServerConfigMock = vi.hoisted(() =>
    vi.fn(() => ({
        SSH_DEFAULT_PORT: 2222,
        SSH_DEFAULT_PROFILER_PATH: '',
        SSH_DEFAULT_PERFORMANCE_PATH: '',
        USERNAME: 'bob',
        SERVER_MODE: false,
    })),
);

const useSshConfigHostsMock = vi.hoisted(() => vi.fn<(enabled?: boolean) => SshConfigHostsQueryResult>());

vi.mock('../src/functions/getServerConfig', () => ({
    default: getServerConfigMock,
}));

vi.mock('../src/hooks/useSshConfigHosts', () => ({
    default: useSshConfigHostsMock,
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
    useSshConfigHostsMock.mockReturnValue(noSshConfigResult());
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
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu', user: 'alice', port: 2222 }]));

        render(
            <MlirServerDialog
                open
                onClose={vi.fn()}
                onAddServer={vi.fn()}
            />,
        );

        fireEvent.change(screen.getByLabelText('SSH identity file (optional)'), {
            target: { value: '/tmp/id_ed25519' },
        });
        fireEvent.change(screen.getByLabelText('SSH config host'), { target: { value: 'work-gpu' } });

        expect(screen.getByLabelText('Name')).toHaveValue('work-gpu');
        expect(screen.getByLabelText('SSH host')).toHaveValue('work-gpu');
        expect(screen.getByLabelText('Username')).toHaveValue('alice');
        expect(screen.getByLabelText('SSH port')).toHaveValue('2222');
        expect(screen.getByLabelText('SSH identity file (optional)')).toHaveValue('');
    });

    it('keeps the existing username, sshPort, and server name when the stanza omits them', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'bare-host' }]));

        render(
            <MlirServerDialog
                open
                server={{
                    name: 'my model explorer',
                    host: 'old-host',
                    sshPort: 2022,
                    port: 8080,
                    username: 'carol',
                }}
                onClose={vi.fn()}
                onAddServer={vi.fn()}
            />,
        );

        fireEvent.change(screen.getByLabelText('SSH config host'), { target: { value: 'bare-host' } });

        expect(screen.getByLabelText('Name')).toHaveValue('my model explorer');
        expect(screen.getByLabelText('SSH host')).toHaveValue('bare-host');
        expect(screen.getByLabelText('Username')).toHaveValue('carol');
        expect(screen.getByLabelText('SSH port')).toHaveValue('2022');
    });

    it('leaves the MLIR server port alone when the stanza carries an SSH Port', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu', port: 2222 }]));

        render(
            <MlirServerDialog
                open
                onClose={vi.fn()}
                onAddServer={vi.fn()}
            />,
        );

        const mlirPort = screen.getByLabelText('MLIR port') as HTMLInputElement;
        const portBeforePrefill = mlirPort.value;
        fireEvent.change(screen.getByLabelText('SSH config host'), { target: { value: 'work-gpu' } });

        expect(screen.getByLabelText('SSH port')).toHaveValue('2222');
        expect(mlirPort).toHaveValue(portBeforePrefill);
    });

    it('gates the config-host fetch on the dialog being open', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu' }]));
        const props = { onClose: vi.fn(), onAddServer: vi.fn() };

        const { unmount } = render(
            <MlirServerDialog
                open={false}
                {...props}
            />,
        );

        // Blueprint unmounts the dialog body when closed, so nothing reads ~/.ssh/config;
        // enabled={open} keeps the fetch gated if the picker is ever rendered outside it.
        expect(useSshConfigHostsMock).not.toHaveBeenCalled();
        unmount();

        render(
            <MlirServerDialog
                open
                {...props}
            />,
        );

        expect(useSshConfigHostsMock).toHaveBeenLastCalledWith(true);
    });

    it('hides the SSH config host picker under SERVER_MODE', () => {
        getServerConfigMock.mockReturnValue({
            SSH_DEFAULT_PORT: 2222,
            SSH_DEFAULT_PROFILER_PATH: '',
            SSH_DEFAULT_PERFORMANCE_PATH: '',
            USERNAME: 'bob',
            SERVER_MODE: true,
        });
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'should-not-show' }]));

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
