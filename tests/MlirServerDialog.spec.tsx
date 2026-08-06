// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MlirServerDialog from '../src/components/report-selection/MlirServerDialog';
import { ConnectionStatus, ConnectionTestStates } from '../src/definitions/ConnectionStatus';
import { SSH_CONFIG_HOST_CUSTOM, SSH_CONFIG_HOST_LABEL } from '../src/definitions/SshConfigHostPicker';
import getButtonWithText from './helpers/getButtonWithText';
import { SshConfigHostsQueryResult, noSshConfigResult, sshConfigHostsResult } from './helpers/sshConfigFixtures';
import { ExistingTarget, describeSshConfigPrefillContract } from './helpers/sshConfigPrefillContract';

// Declared inside the hoisted factory: it runs before module-scope consts initialise.
const { getServerConfigMock, SERVER_CONFIG } = vi.hoisted(() => {
    const config = {
        SSH_DEFAULT_PORT: 2222,
        SSH_DEFAULT_PROFILER_PATH: '',
        SSH_DEFAULT_PERFORMANCE_PATH: '',
        USERNAME: 'bob',
        SERVER_MODE: false,
    };

    return { getServerConfigMock: vi.fn(() => config), SERVER_CONFIG: config };
});

const useSshConfigHostsMock = vi.hoisted(() => vi.fn<(enabled?: boolean) => SshConfigHostsQueryResult>());

const testMlirServerConnectionMock = vi.hoisted(() => vi.fn<() => Promise<ConnectionStatus[]>>());

vi.mock('../src/functions/getServerConfig', () => ({
    default: getServerConfigMock,
}));

vi.mock('../src/hooks/useSshConfigHosts', () => ({
    default: useSshConfigHostsMock,
}));

vi.mock('../src/hooks/useMlirRemote', () => ({
    default: () => ({
        testMlirServerConnection: testMlirServerConnectionMock,
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
    testMlirServerConnectionMock.mockClear();
    testMlirServerConnectionMock.mockResolvedValue([]);
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

const MLIR_SERVER_REACHABLE = 'MLIR server reachable';
const MLIR_TEST_PROMPT = 'Check the MLIR server connection is valid';

const renderMlirServerDialog = ({ open = true, existing }: { open?: boolean; existing?: ExistingTarget } = {}) =>
    render(
        <MlirServerDialog
            open={open}
            server={
                existing && {
                    name: existing.name,
                    host: existing.host,
                    username: existing.username,
                    sshPort: 22,
                    port: 8080,
                }
            }
            onClose={vi.fn()}
            onAddServer={vi.fn()}
        />,
    );

describeSshConfigPrefillContract('MlirServerDialog', {
    renderDialog: renderMlirServerDialog,
    hostLabel: 'SSH host',
    sshPortLabel: 'SSH port',
    runTestsLabel: 'Run test',
    saveLabel: 'Add server',
    passingTestMessage: MLIR_SERVER_REACHABLE,
    useSshConfigHostsMock,
    setServerMode: (serverMode) => getServerConfigMock.mockReturnValue({ ...SERVER_CONFIG, SERVER_MODE: serverMode }),
    mockPassingTest: () =>
        testMlirServerConnectionMock.mockResolvedValue([
            { status: ConnectionTestStates.OK, message: MLIR_SERVER_REACHABLE },
        ]),
    defaultUsername: SERVER_CONFIG.USERNAME,
});

describe('MlirServerDialog connection test block', () => {
    it('prompts for a test before one has run, and again once a result is invalidated', async () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu', user: 'alice' }]));
        testMlirServerConnectionMock.mockResolvedValue([
            { status: ConnectionTestStates.OK, message: MLIR_SERVER_REACHABLE },
        ]);

        renderMlirServerDialog();

        expect(screen.getByText(MLIR_TEST_PROMPT)).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'my model explorer' } });
        fireEvent.change(screen.getByLabelText('SSH host'), { target: { value: 'aus-wh-05' } });
        fireEvent.click(getButtonWithText('Run test'));
        await waitFor(() => expect(screen.getByText(MLIR_SERVER_REACHABLE)).toBeInTheDocument());
        expect(screen.queryByText(MLIR_TEST_PROMPT)).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('SSH host'), { target: { value: 'somewhere-else' } });

        // Unlike the remote connection dialog, this one drops the result outright
        // rather than keeping it on screen marked stale.
        expect(screen.queryByText(MLIR_SERVER_REACHABLE)).not.toBeInTheDocument();
        expect(screen.getByText(MLIR_TEST_PROMPT)).toBeInTheDocument();
    });
});

// Behaviour specific to this dialog; the rest of the prefill contract is asserted above.
describe('MlirServerDialog SSH config prefill specifics', () => {
    // Unlike the remote connection dialog, this one still offers the picker for a saved server.
    it('opens with the alias selected when the existing host matches one', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu', user: 'alice' }]));

        renderMlirServerDialog({ existing: { name: 'saved', host: 'work-gpu', username: 'carol' } });

        // initialHost exists for this: a saved server pointing at an alias should not read as
        // Custom, or reopening the dialog implies the stanza no longer applies.
        expect(screen.getByLabelText<HTMLSelectElement>(SSH_CONFIG_HOST_LABEL).value).toBe('work-gpu');
    });

    it('reads as Custom when the existing host matches no alias', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu', user: 'alice' }]));

        renderMlirServerDialog({ existing: { name: 'saved', host: 'not-an-alias', username: 'carol' } });

        expect(screen.getByLabelText<HTMLSelectElement>(SSH_CONFIG_HOST_LABEL).value).toBe(SSH_CONFIG_HOST_CUSTOM);
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

        fireEvent.change(screen.getByLabelText(SSH_CONFIG_HOST_LABEL), { target: { value: 'bare-host' } });

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
        fireEvent.change(screen.getByLabelText(SSH_CONFIG_HOST_LABEL), { target: { value: 'work-gpu' } });

        expect(screen.getByLabelText('SSH port')).toHaveValue('2222');
        expect(mlirPort).toHaveValue(portBeforePrefill);
    });
});
