// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RemoteConnectionDialog from '../src/components/report-selection/RemoteConnectionDialog';
import {
    ConnectionNameSubject,
    STALE_CONNECTION_TESTS_CLASS,
    getNameAvailableMessage,
    getNameRequiredMessage,
    getNameTakenMessage,
} from '../src/definitions/ConnectionDialog';
import { ConnectionStatus, ConnectionTestStates } from '../src/definitions/ConnectionStatus';
import { RemoteConnection } from '../src/definitions/RemoteConnection';
import { SSH_CONFIG_HOST_CUSTOM, SSH_CONFIG_HOST_LABEL } from '../src/definitions/SshConfigHostPicker';
import { SSH_IDENTITY_FILE_LABEL } from '../src/definitions/SshConnectionFields';
import { TEST_IDS } from '../src/definitions/TestIds';
import getButtonWithText from './helpers/getButtonWithText';
import { MULTIHOST_CHECKBOX_NAME } from './helpers/multihostCheckbox';
import {
    SshConfigHostsQueryResult,
    noSshConfigResult,
    pendingSshConfigResult,
    sshConfigHostsResult,
} from './helpers/sshConfigFixtures';
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
        expect(screen.getByLabelText('Remote memory report folder path')).toHaveValue('/mem');
        expect(screen.getByLabelText('Remote performance report folder path')).toHaveValue('/perf');
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

        expect(screen.getByLabelText('Remote performance report folder path')).toHaveValue('');
    });
});

const getTestBlock = () => screen.queryByRole('group', { name: 'Test Connection' });

/** The server results, which go stale — as opposed to the name check, which is recomputed. */
const getServerTestResults = () => screen.getByTestId(TEST_IDS.CONNECTION_TEST_RESULTS);

/** Saving needs a name, so anything that ends at an enabled save button has to supply one. */
const fillName = (name = 'my lab box') => fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });

const PASSING_TESTS: ConnectionStatus[] = [
    { status: ConnectionTestStates.OK, message: 'SSH connection established' },
    { status: ConnectionTestStates.OK, message: 'Found 3 memory reports' },
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
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        // Reaching the Name field at all means choosing something first, so the name is
        // typed after one alias and kept when the user settles on another.
        fireEvent.change(screen.getByLabelText(SSH_CONFIG_HOST_LABEL), { target: { value: SSH_CONFIG_HOST_CUSTOM } });
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'my lab box' } });
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

describe('RemoteConnectionDialog host choice gate', () => {
    const CONFIG_HOSTS = [{ host: 'work-gpu', user: 'alice', port: 2222 }];

    const getPicker = () => screen.getByLabelText(SSH_CONFIG_HOST_LABEL) as HTMLSelectElement;
    const queryNameField = () => screen.queryByLabelText('Name');

    it('shows nothing but the picker, and no actions, until a choice is made', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult(CONFIG_HOSTS));

        renderRemoteConnectionDialog();

        expect(getPicker()).toBeInTheDocument();
        expect(queryNameField()).not.toBeInTheDocument();
        expect(screen.queryByLabelText('SSH Host')).not.toBeInTheDocument();
        // A form that isn't on screen has nothing to test or save.
        expect(screen.queryByRole('button', { name: 'Run tests' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Add connection' })).not.toBeInTheDocument();
    });

    it('reveals the form when the add-new option is chosen', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult(CONFIG_HOSTS));

        renderRemoteConnectionDialog();
        fireEvent.change(getPicker(), { target: { value: SSH_CONFIG_HOST_CUSTOM } });

        expect(screen.getByLabelText('SSH Host')).toHaveValue('');
        expect(getButtonWithText('Run tests')).toBeInTheDocument();
    });

    it('reveals the form prefilled when a config host is chosen', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult(CONFIG_HOSTS));

        renderRemoteConnectionDialog();
        fireEvent.change(getPicker(), { target: { value: 'work-gpu' } });

        expect(screen.getByLabelText('SSH Host')).toHaveValue('work-gpu');
    });

    it('waits for ~/.ssh/config before deciding, rather than showing a form it takes away', () => {
        useSshConfigHostsMock.mockReturnValue(pendingSshConfigResult());

        renderRemoteConnectionDialog();

        expect(queryNameField()).not.toBeInTheDocument();
    });

    it.each([
        ['there is no ~/.ssh/config to choose from', noSshConfigResult],
        ['the config holds no concrete hosts', () => sshConfigHostsResult([])],
    ])('shows the form straight away when %s', (_, result) => {
        useSshConfigHostsMock.mockReturnValue(result());

        renderRemoteConnectionDialog();

        expect(queryNameField()).toBeInTheDocument();
    });

    it('shows the form straight away under SERVER_MODE, where the picker never renders', () => {
        // The query is disabled here, and a disabled query never settles — waiting on
        // the config to load would leave a hosted user with an empty dialog for good.
        getServerConfigMock.mockReturnValue({ ...SERVER_CONFIG, SERVER_MODE: true });
        useSshConfigHostsMock.mockReturnValue(pendingSshConfigResult());

        renderRemoteConnectionDialog();

        expect(queryNameField()).toBeInTheDocument();
    });

    it('shows the form straight away when an existing connection is being edited', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult(CONFIG_HOSTS));

        renderRemoteConnectionDialog({ existing: { name: 'saved', host: 'not-an-alias', username: 'carol' } });

        expect(screen.getByLabelText('SSH Host')).toHaveValue('not-an-alias');
    });

    it('offers no picker at all when editing, and leaves ~/.ssh/config unread', () => {
        useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult(CONFIG_HOSTS));

        // The prefill replaces host, name, username, port and identity file together, so on a
        // connection that already has them it is an offer to undo the edit.
        renderRemoteConnectionDialog({ existing: { name: 'saved', host: 'work-gpu', username: 'carol' } });

        expect(screen.queryByLabelText(SSH_CONFIG_HOST_LABEL)).not.toBeInTheDocument();
        expect(useSshConfigHostsMock).not.toHaveBeenCalledWith(true);
    });
});

describe('RemoteConnectionDialog connection test block', () => {
    it('stays hidden until a test is run, then survives an edit as a stale result', async () => {
        testConnectionMock.mockResolvedValue(PASSING_TESTS);

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        expect(getTestBlock()).not.toBeInTheDocument();

        fireEvent.click(getButtonWithText('Run tests'));
        await waitFor(() => expect(screen.getByText('SSH connection established')).toBeInTheDocument());
        expect(getServerTestResults()).not.toHaveClass(STALE_CONNECTION_TESTS_CLASS);

        fireEvent.change(screen.getByLabelText('SSH Host'), { target: { value: 'other-host' } });

        // The record of what the last run found is worth more than a clean slate,
        // as long as it can't be read as approving the target now in the form.
        expect(screen.getByText('SSH connection established')).toBeInTheDocument();
        expect(getServerTestResults()).toHaveClass(STALE_CONNECTION_TESTS_CLASS);
    });

    it('lets a warning be saved, since an empty report folder is not a broken connection', async () => {
        // The server reports a configured path holding no reports as WARNING rather than
        // failing, so tightening this gate to OK-only would lock out the very case it
        // was widened for — a host whose reports haven't been generated yet.
        testConnectionMock.mockResolvedValue([
            { status: ConnectionTestStates.OK, message: 'SSH connection established' },
            { status: ConnectionTestStates.WARNING, message: 'Memory path exists but no reports found' },
        ]);

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        fillName();
        fireEvent.click(getButtonWithText('Run tests'));

        await waitFor(() => expect(screen.getByText('Memory path exists but no reports found')).toBeInTheDocument());
        expect(getButtonWithText('Add connection')).toBeEnabled();
    });

    it('drops the stale marking once the tests are run again', async () => {
        testConnectionMock.mockResolvedValue(PASSING_TESTS);

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        fillName();
        fireEvent.click(getButtonWithText('Run tests'));
        await waitFor(() => expect(getButtonWithText('Add connection')).toBeEnabled());
        fireEvent.change(screen.getByLabelText('SSH Host'), { target: { value: 'other-host' } });
        expect(getServerTestResults()).toHaveClass(STALE_CONNECTION_TESTS_CLASS);

        fireEvent.click(getButtonWithText('Run tests'));

        await waitFor(() => expect(getButtonWithText('Add connection')).toBeEnabled());
        expect(getServerTestResults()).not.toHaveClass(STALE_CONNECTION_TESTS_CLASS);
    });
});

describe('RemoteConnectionDialog connection name validation', () => {
    const SAVED: RemoteConnection = {
        name: 'Worker',
        host: 'worker-01',
        port: 2222,
        username: 'tt',
        profilerPath: '/mem',
    };

    const renderWithSaved = (props: Partial<ComponentProps<typeof RemoteConnectionDialog>> = {}) =>
        render(
            <RemoteConnectionDialog
                open
                existingConnections={[SAVED]}
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
                {...props}
            />,
        );

    it('reports a duplicate name as soon as it is typed, without waiting for a test run', () => {
        renderWithSaved();

        expect(getTestBlock()).not.toBeInTheDocument();

        fillName(SAVED.name);

        expect(screen.getByText(getNameTakenMessage(ConnectionNameSubject.CONNECTION, SAVED.name))).toBeInTheDocument();
        expect(getButtonWithText('Add connection')).toBeDisabled();
    });

    it.each([
        ['case', 'worker'],
        ['surrounding space', '  Worker  '],
    ])('reports a name differing only by %s as a duplicate', (_difference, name) => {
        renderWithSaved();

        fillName(name);

        expect(
            screen.getByText(getNameTakenMessage(ConnectionNameSubject.CONNECTION, name.trim())),
        ).toBeInTheDocument();
    });

    it('keeps a duplicate name from being saved even after the tests pass', async () => {
        testConnectionMock.mockResolvedValue(PASSING_TESTS);
        renderWithSaved();

        fillName('my lab box');
        fireEvent.click(getButtonWithText('Run tests'));
        await waitFor(() => expect(getButtonWithText('Add connection')).toBeEnabled());

        // A rename doesn't invalidate the SSH results, so nothing else here would notice.
        fillName(SAVED.name);

        expect(screen.getByText('SSH connection established')).toBeInTheDocument();
        expect(getButtonWithText('Add connection')).toBeDisabled();
    });

    it('takes the failure back down when the name is changed to a free one', () => {
        renderWithSaved();

        fillName(SAVED.name);
        expect(getTestBlock()).toBeInTheDocument();

        fillName('Worker 2');

        // With nothing left to report and no test run to report it alongside, the whole
        // block goes rather than leaving a tick the user never asked for.
        expect(getTestBlock()).not.toBeInTheDocument();
    });

    it('reports a missing name with the rest of the results, rather than before them', async () => {
        testConnectionMock.mockResolvedValue(PASSING_TESTS);
        renderWithSaved();

        // Nothing to complain about until the user asks for a verdict.
        expect(getTestBlock()).not.toBeInTheDocument();

        fireEvent.click(getButtonWithText('Run tests'));

        await waitFor(() =>
            expect(screen.getByText(getNameRequiredMessage(ConnectionNameSubject.CONNECTION))).toBeInTheDocument(),
        );
        // Saved without a name, the connection is discarded as invalid on the next read.
        expect(getButtonWithText('Add connection')).toBeDisabled();
    });

    it('does not report the connection being edited as a duplicate of itself', async () => {
        testConnectionMock.mockResolvedValue(PASSING_TESTS);
        renderWithSaved({ remoteConnection: SAVED, buttonLabel: 'Save connection' });

        fireEvent.click(getButtonWithText('Run tests'));

        await waitFor(() => expect(getButtonWithText('Save connection')).toBeEnabled());
        expect(screen.getByText(getNameAvailableMessage(ConnectionNameSubject.CONNECTION))).toBeInTheDocument();
    });

    it('reports an edit that takes the name of a different connection', () => {
        const other: RemoteConnection = { ...SAVED, name: 'Spare', host: 'worker-02' };

        renderWithSaved({ existingConnections: [SAVED, other], remoteConnection: SAVED });

        fillName(other.name);

        expect(screen.getByText(getNameTakenMessage(ConnectionNameSubject.CONNECTION, other.name))).toBeInTheDocument();
    });
});

describe('RemoteConnectionDialog connection test invalidation', () => {
    it.each([
        ['SSH Host', 'other-host'],
        ['Username', 'carol'],
        ['SSH Port', '2022'],
        ['Remote memory report folder path', '/elsewhere'],
        ['Remote performance report folder path', '/elsewhere-perf'],
        [SSH_IDENTITY_FILE_LABEL, '/tmp/id_ed25519'],
    ])('stops a passing test result gating the save when %s is edited by hand', async (label, value) => {
        testConnectionMock.mockResolvedValue(PASSING_TESTS);

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        fillName();
        fireEvent.change(screen.getByLabelText('SSH Host'), { target: { value: 'work-gpu' } });
        fireEvent.click(getButtonWithText('Run tests'));
        await waitFor(() => expect(getButtonWithText('Add connection')).toBeEnabled());

        fireEvent.change(screen.getByLabelText(label), { target: { value } });

        expect(getServerTestResults()).toHaveClass(STALE_CONNECTION_TESTS_CLASS);
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

        fillName();
        fireEvent.click(getButtonWithText('Run tests'));
        await waitFor(() => expect(getButtonWithText('Add connection')).toBeEnabled());

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'renamed box' } });

        expect(screen.getByText('SSH connection established')).toBeInTheDocument();
        expect(getServerTestResults()).not.toHaveClass(STALE_CONNECTION_TESTS_CLASS);
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

describe('RemoteConnectionDialog multihost performance flag', () => {
    it('defaults to unchecked for a new connection', () => {
        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        expect(screen.getByRole('checkbox', { name: MULTIHOST_CHECKBOX_NAME })).not.toBeChecked();
    });

    it('reflects the saved flag when editing a connection', () => {
        const remoteConnection: RemoteConnection = {
            name: 'c',
            host: 'h',
            port: 22,
            username: 'u',
            profilerPath: '/p',
            performancePath: '/remote/generated/profiler/ttrun',
            multihostPerformance: true,
        };

        render(
            <RemoteConnectionDialog
                open
                remoteConnection={remoteConnection}
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        expect(screen.getByRole('checkbox', { name: MULTIHOST_CHECKBOX_NAME })).toBeChecked();
    });

    it('sends the flag with the connection test and the saved connection', async () => {
        testConnectionMock.mockResolvedValue(PASSING_TESTS);
        const onAddConnection = vi.fn();

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={onAddConnection}
            />,
        );

        fillName();
        fireEvent.click(screen.getByRole('checkbox', { name: MULTIHOST_CHECKBOX_NAME }));
        fireEvent.click(getButtonWithText('Run tests'));

        await waitFor(() =>
            expect(testConnectionMock).toHaveBeenCalledWith(expect.objectContaining({ multihostPerformance: true })),
        );

        const saveButton = getButtonWithText('Add connection');
        await waitFor(() => expect(saveButton).toBeEnabled());
        fireEvent.click(saveButton);

        expect(onAddConnection).toHaveBeenCalledWith(expect.objectContaining({ multihostPerformance: true }));
    });

    it('stops a passing test result gating the save when the flag is toggled', async () => {
        // The flag selects which layout is searched, so a result computed for the
        // other one says nothing about this connection and must not gate the save.
        testConnectionMock.mockResolvedValue(PASSING_TESTS);

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        fillName();
        fireEvent.click(getButtonWithText('Run tests'));
        await waitFor(() => expect(getButtonWithText('Add connection')).toBeEnabled());

        fireEvent.click(screen.getByRole('checkbox', { name: MULTIHOST_CHECKBOX_NAME }));

        expect(getServerTestResults()).toHaveClass(STALE_CONNECTION_TESTS_CLASS);
        expect(getButtonWithText('Add connection')).toBeDisabled();
    });
});
