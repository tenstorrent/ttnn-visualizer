// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MlirServerDialog from '../src/components/report-selection/MlirServerDialog';
import {
    ConnectionNameSubject,
    STALE_CONNECTION_TESTS_CLASS,
    getNameAvailableMessage,
    getNameFieldLabel,
    getNameRequiredMessage,
    getNameTakenMessage,
} from '../src/definitions/ConnectionDialog';
import { ConnectionStatus, ConnectionTestStates } from '../src/definitions/ConnectionStatus';
import { MLIR_PORT_LABEL, MlirServerConnection } from '../src/definitions/MlirServer';
import { SSH_CONFIG_HOST_CUSTOM, SSH_CONFIG_HOST_SUBLABEL } from '../src/definitions/SshConfigHostPicker';
import { SSH_HOST_LABEL, SSH_PORT_LABEL, SSH_USERNAME_LABEL } from '../src/definitions/SshConnectionFields';
import { TEST_IDS } from '../src/definitions/TestIds';
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

        expect(screen.getByLabelText(SSH_PORT_LABEL)).toHaveValue('2222');
        expect(screen.getByLabelText(SSH_USERNAME_LABEL)).toHaveValue('bob');
    });
});

const MLIR_SERVER_REACHABLE = 'MLIR server reachable';

const SERVER_NAME_LABEL = getNameFieldLabel(ConnectionNameSubject.SERVER);

const getTestBlock = () => screen.queryByRole('group', { name: 'Test Connection' });

/** The server results, which go stale — as opposed to the name check, which is recomputed. */
const getServerTestResults = () => screen.getByTestId(TEST_IDS.CONNECTION_TEST_RESULTS);

/** Saving needs a name, so anything that ends at an enabled save button has to supply one. */
const fillName = (name = 'my model explorer') =>
    fireEvent.change(screen.getByLabelText(SERVER_NAME_LABEL), { target: { value: name } });

/** What the test needs to reach a server at all, so Run test is offered. */
const fillTestableTarget = () =>
    fireEvent.change(screen.getByLabelText(SSH_HOST_LABEL), { target: { value: 'aus-wh-05' } });

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
    nameSubject: ConnectionNameSubject.SERVER,
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
    it('stays hidden until a test is run, then survives an edit as a stale result', async () => {
        testMlirServerConnectionMock.mockResolvedValue([
            { status: ConnectionTestStates.OK, message: MLIR_SERVER_REACHABLE },
        ]);

        renderMlirServerDialog();

        expect(getTestBlock()).not.toBeInTheDocument();

        fillName();
        fillTestableTarget();
        fireEvent.click(getButtonWithText('Run test'));
        await waitFor(() => expect(screen.getByText(MLIR_SERVER_REACHABLE)).toBeInTheDocument());
        expect(getServerTestResults()).not.toHaveClass(STALE_CONNECTION_TESTS_CLASS);

        fireEvent.change(screen.getByLabelText(SSH_HOST_LABEL), { target: { value: 'somewhere-else' } });

        // Aligned with the remote connection dialog: the record of what the last run found is
        // worth more than a clean slate, as long as it can't be read as approving the target
        // now in the form.
        expect(screen.getByText(MLIR_SERVER_REACHABLE)).toBeInTheDocument();
        expect(getServerTestResults()).toHaveClass(STALE_CONNECTION_TESTS_CLASS);
        expect(getButtonWithText('Add server')).toBeDisabled();
    });

    it('offers the test before a name is given, and reports the missing name with the results', async () => {
        testMlirServerConnectionMock.mockResolvedValue([
            { status: ConnectionTestStates.OK, message: MLIR_SERVER_REACHABLE },
        ]);

        renderMlirServerDialog();

        // The name is no part of what the test exercises, so withholding the run over one
        // would make the user guess at whether the target itself is reachable.
        fillTestableTarget();
        fireEvent.click(getButtonWithText('Run test'));

        await waitFor(() =>
            expect(screen.getByText(getNameRequiredMessage(ConnectionNameSubject.SERVER))).toBeInTheDocument(),
        );
        expect(screen.getByText(MLIR_SERVER_REACHABLE)).toBeInTheDocument();
        expect(getButtonWithText('Add server')).toBeDisabled();
    });
});

describe('MlirServerDialog server name validation', () => {
    const SAVED: MlirServerConnection = {
        name: 'Explorer',
        username: 'tt',
        host: 'aus-wh-05',
        sshPort: 22,
        port: 8080,
    };

    const renderWithSaved = (props: Partial<ComponentProps<typeof MlirServerDialog>> = {}) =>
        render(
            <MlirServerDialog
                open
                existingServers={[SAVED]}
                onClose={vi.fn()}
                onAddServer={vi.fn()}
                {...props}
            />,
        );

    it('reports a duplicate name as soon as it is typed, without waiting for a test run', () => {
        renderWithSaved();

        expect(getTestBlock()).not.toBeInTheDocument();

        fillName(SAVED.name);

        expect(screen.getByText(getNameTakenMessage(ConnectionNameSubject.SERVER, SAVED.name))).toBeInTheDocument();
        expect(getButtonWithText('Add server')).toBeDisabled();
    });

    it('keeps a duplicate name from being saved even after the test passes', async () => {
        testMlirServerConnectionMock.mockResolvedValue([
            { status: ConnectionTestStates.OK, message: MLIR_SERVER_REACHABLE },
        ]);
        renderWithSaved();

        fillName();
        fillTestableTarget();
        fireEvent.click(getButtonWithText('Run test'));
        await waitFor(() => expect(getButtonWithText('Add server')).toBeEnabled());

        // A rename doesn't invalidate the SSH result, so nothing else here would notice.
        fillName(SAVED.name);

        expect(screen.getByText(MLIR_SERVER_REACHABLE)).toBeInTheDocument();
        expect(getButtonWithText('Add server')).toBeDisabled();
    });

    it('does not report the server being edited as a duplicate of itself', async () => {
        testMlirServerConnectionMock.mockResolvedValue([
            { status: ConnectionTestStates.OK, message: MLIR_SERVER_REACHABLE },
        ]);
        renderWithSaved({ server: SAVED, buttonLabel: 'Save server' });

        fireEvent.click(getButtonWithText('Run test'));

        await waitFor(() => expect(getButtonWithText('Save server')).toBeEnabled());
        expect(screen.getByText(getNameAvailableMessage(ConnectionNameSubject.SERVER))).toBeInTheDocument();
    });
});

// Behaviour specific to this dialog; the rest of the prefill contract is asserted above.
describe('MlirServerDialog SSH config prefill specifics', () => {
    it('keeps the username, sshPort, and server name already entered when the stanza omits them', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'bare-host' }]));

        renderMlirServerDialog();

        fireEvent.change(screen.getByLabelText(SSH_CONFIG_HOST_SUBLABEL), {
            target: { value: SSH_CONFIG_HOST_CUSTOM },
        });
        fillName();
        fireEvent.change(screen.getByLabelText(SSH_USERNAME_LABEL), { target: { value: 'carol' } });
        fireEvent.change(screen.getByLabelText(SSH_PORT_LABEL), { target: { value: '2022' } });
        fireEvent.change(screen.getByLabelText(SSH_CONFIG_HOST_SUBLABEL), { target: { value: 'bare-host' } });

        expect(screen.getByLabelText(SERVER_NAME_LABEL)).toHaveValue('my model explorer');
        expect(screen.getByLabelText(SSH_HOST_LABEL)).toHaveValue('bare-host');
        expect(screen.getByLabelText(SSH_USERNAME_LABEL)).toHaveValue('carol');
        expect(screen.getByLabelText(SSH_PORT_LABEL)).toHaveValue('2022');
    });

    it('leaves the MLIR server port alone when the stanza carries an SSH Port', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'work-gpu', port: 2222 }]));

        renderMlirServerDialog();

        fireEvent.change(screen.getByLabelText(SSH_CONFIG_HOST_SUBLABEL), {
            target: { value: SSH_CONFIG_HOST_CUSTOM },
        });
        const mlirPort = screen.getByLabelText(MLIR_PORT_LABEL) as HTMLInputElement;
        const portBeforePrefill = mlirPort.value;
        fireEvent.change(screen.getByLabelText(SSH_CONFIG_HOST_SUBLABEL), { target: { value: 'work-gpu' } });

        expect(screen.getByLabelText(SSH_PORT_LABEL)).toHaveValue('2222');
        expect(mlirPort).toHaveValue(portBeforePrefill);
    });
});
