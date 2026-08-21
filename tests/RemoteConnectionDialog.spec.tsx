// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RemoteConnectionDialog from '../src/components/report-selection/RemoteConnectionDialog';
import {
    ConnectionNameSubject,
    STALE_CONNECTION_TESTS_CLASS,
    getNameAvailableMessage,
    getNameFieldLabel,
    getNameRequiredMessage,
    getNameTakenMessage,
} from '../src/definitions/ConnectionDialog';
import { ConnectionStatus, ConnectionTestStates } from '../src/definitions/ConnectionStatus';
import { HostKeyIssue } from '../src/definitions/HostKey';
import { HostKeyStatus } from '../src/model/HostKey';
import {
    REMOTE_MEMORY_PATH_LABEL,
    REMOTE_PERFORMANCE_PATH_LABEL,
    RemoteConnection,
} from '../src/definitions/RemoteConnection';
import { SSH_CONFIG_HOST_CUSTOM, SSH_CONFIG_HOST_SUBLABEL } from '../src/definitions/SshConfigHostPicker';
import {
    REMOTE_PATH_NOT_ABSOLUTE_ERROR,
    SSH_HOST_LABEL,
    SSH_IDENTITY_FILE_LABEL,
    SSH_PORT_LABEL,
    SSH_USERNAME_LABEL,
} from '../src/definitions/SshConnectionFields';
import { TEST_IDS } from '../src/definitions/TestIds';
import getButtonWithText from './helpers/getButtonWithText';
import { QueryProvider } from './helpers/queryClientProvider';
import { MULTIHOST_CHECKBOX_NAME } from './helpers/multihostCheckbox';
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

const { fetchHostKeyOfferMock, trustHostKeyMock } = vi.hoisted(() => ({
    fetchHostKeyOfferMock: vi.fn(),
    trustHostKeyMock: vi.fn(),
}));

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

vi.mock('../src/hooks/useHostKey', () => ({
    default: () => ({
        fetchHostKeyOffer: fetchHostKeyOfferMock,
        trustHostKey: trustHostKeyMock,
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
    fetchHostKeyOfferMock.mockClear();
    trustHostKeyMock.mockClear();
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

        expect(screen.getByLabelText(SSH_PORT_LABEL)).toHaveValue('2222');
        expect(screen.getByLabelText(REMOTE_MEMORY_PATH_LABEL)).toHaveValue('/mem');
        expect(screen.getByLabelText(REMOTE_PERFORMANCE_PATH_LABEL)).toHaveValue('/perf');
        expect(screen.getByLabelText(SSH_USERNAME_LABEL)).toHaveValue('bob');
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

        expect(screen.getByLabelText(REMOTE_PERFORMANCE_PATH_LABEL)).toHaveValue('');
    });
});

const CONNECTION_NAME_LABEL = getNameFieldLabel(ConnectionNameSubject.CONNECTION);

const getTestBlock = () => screen.queryByRole('group', { name: 'Test Connection' });

/** The server results, which go stale — as opposed to the name check, which is recomputed. */
const getServerTestResults = () => screen.getByTestId(TEST_IDS.CONNECTION_TEST_RESULTS);

/** Saving needs a name, so anything that ends at an enabled save button has to supply one. */
const fillName = (name = 'my lab box') =>
    fireEvent.change(screen.getByLabelText(CONNECTION_NAME_LABEL), { target: { value: name } });

const PASSING_TESTS: ConnectionStatus[] = [
    { status: ConnectionTestStates.OK, message: 'SSH connection established' },
    { status: ConnectionTestStates.OK, message: 'Found 3 memory reports' },
];

/**
 * What the server really sends when both paths are configured: a line each.
 *
 * `PASSING_TESTS` is one line short of that, so asserting a placeholder is gone
 * against it proves only that the response was shorter — which is the failure
 * being ruled out, not the behaviour being checked.
 */
const PASSING_TESTS_BOTH_PATHS: ConnectionStatus[] = [
    ...PASSING_TESTS,
    { status: ConnectionTestStates.OK, message: 'Found 2 performance reports' },
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
    nameSubject: ConnectionNameSubject.CONNECTION,
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
        fireEvent.change(screen.getByLabelText(SSH_CONFIG_HOST_SUBLABEL), {
            target: { value: SSH_CONFIG_HOST_CUSTOM },
        });
        fireEvent.change(screen.getByLabelText(CONNECTION_NAME_LABEL), { target: { value: 'my lab box' } });
        fireEvent.change(screen.getByLabelText(SSH_CONFIG_HOST_SUBLABEL), { target: { value: 'work-gpu' } });

        expect(screen.getByLabelText(CONNECTION_NAME_LABEL)).toHaveValue('my lab box');
        expect(screen.getByLabelText(SSH_HOST_LABEL)).toHaveValue('work-gpu');
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

        fireEvent.change(screen.getByLabelText(SSH_CONFIG_HOST_SUBLABEL), { target: { value: 'bare-host' } });

        expect(screen.getByLabelText(SSH_USERNAME_LABEL)).toHaveValue('bob');
        expect(screen.getByLabelText(SSH_HOST_LABEL)).toHaveValue('bare-host');
        expect(screen.getByLabelText(CONNECTION_NAME_LABEL)).toHaveValue('bare-host');
        expect(screen.getByLabelText(SSH_PORT_LABEL)).toHaveValue('45985');
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

        fireEvent.change(screen.getByLabelText(SSH_HOST_LABEL), { target: { value: 'other-host' } });

        // The record of what the last run found is worth more than a clean slate,
        // as long as it can't be read as approving the target now in the form.
        expect(screen.getByText('SSH connection established')).toBeInTheDocument();
        expect(getServerTestResults()).toHaveClass(STALE_CONNECTION_TESTS_CLASS);
    });

    it('leaves the name check outside the stale marking, since it is recomputed', async () => {
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

        fireEvent.change(screen.getByLabelText(SSH_HOST_LABEL), { target: { value: 'other-host' } });

        // The name check is recomputed against the form as it stands, so greying it out
        // alongside the run's results would recede a verdict that is still current.
        const nameMessage = getNameAvailableMessage(ConnectionNameSubject.CONNECTION);
        expect(screen.getByText(nameMessage)).toBeInTheDocument();
        expect(getServerTestResults()).toHaveClass(STALE_CONNECTION_TESTS_CLASS);
        expect(within(getServerTestResults()).queryByText(nameMessage)).not.toBeInTheDocument();
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

    it('reports both paths when one of them fails, and a failing path blocks saving', async () => {
        // The bug behind #1856: the server answered only the failing path, and the
        // response replaces the whole list, so the memory row the user was watching
        // disappeared rather than showing the count already computed.
        testConnectionMock.mockResolvedValue([
            { status: ConnectionTestStates.OK, message: 'SSH connection established' },
            { status: ConnectionTestStates.OK, message: 'Found 3 memory reports' },
            {
                status: ConnectionTestStates.FAILED,
                message: 'Performance directory does not exist or cannot be accessed',
            },
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

        await waitFor(() => expect(screen.getByText('Found 3 memory reports')).toBeInTheDocument());
        expect(screen.getByText('Performance directory does not exist or cannot be accessed')).toBeInTheDocument();
        expect(getButtonWithText('Add connection')).toBeDisabled();
    });

    it('seeds one search placeholder per configured path while the test is in flight', async () => {
        // Held unresolved on purpose: the placeholders only exist between the click
        // and the response, so a mock that resolves immediately asserts nothing about
        // them — the response replaces the whole list either way.
        let resolveTest: (statuses: ConnectionStatus[]) => void = () => {};
        testConnectionMock.mockReturnValue(
            new Promise<ConnectionStatus[]>((resolve) => {
                resolveTest = resolve;
            }),
        );

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        fillName();
        fireEvent.click(getButtonWithText('Run tests'));

        // Both paths are prefilled from getServerConfig, so both are configured here.
        expect(screen.getByText('Testing SSH connection')).toBeInTheDocument();
        expect(screen.getByText('Searching for memory reports')).toBeInTheDocument();
        expect(screen.getByText('Searching for performance reports')).toBeInTheDocument();

        resolveTest(PASSING_TESTS_BOTH_PATHS);

        // Every placeholder is answered by a real result rather than being left
        // pending — which is why the fixture has to carry a line per placeholder.
        await waitFor(() => expect(screen.getByText('Found 3 memory reports')).toBeInTheDocument());
        expect(screen.getByText('Found 2 performance reports')).toBeInTheDocument();
        expect(screen.queryByText('Searching for memory reports')).not.toBeInTheDocument();
        expect(screen.queryByText('Searching for performance reports')).not.toBeInTheDocument();
    });

    it('leaves no placeholder pending when the server answers with fewer lines than it seeded', async () => {
        // The backend answers every configured path, so this shape should not
        // arrive — but the placeholders are the dialog's own, and a row of its
        // making must never outlive the response and spin forever.
        let resolveTest: (statuses: ConnectionStatus[]) => void = () => {};
        testConnectionMock.mockReturnValue(
            new Promise<ConnectionStatus[]>((resolve) => {
                resolveTest = resolve;
            }),
        );

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        fillName();
        fireEvent.click(getButtonWithText('Run tests'));

        expect(screen.getByText('Searching for performance reports')).toBeInTheDocument();

        // Two lines against the three placeholders above.
        resolveTest(PASSING_TESTS);

        await waitFor(() => expect(screen.getByText('Found 3 memory reports')).toBeInTheDocument());
        expect(screen.queryByText('Testing SSH connection')).not.toBeInTheDocument();
        expect(screen.queryByText('Searching for memory reports')).not.toBeInTheDocument();
        expect(screen.queryByText('Searching for performance reports')).not.toBeInTheDocument();
    });

    it('does not seed a placeholder for a path the user cleared', async () => {
        let resolveTest: (statuses: ConnectionStatus[]) => void = () => {};
        testConnectionMock.mockReturnValue(
            new Promise<ConnectionStatus[]>((resolve) => {
                resolveTest = resolve;
            }),
        );

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        fillName();
        fireEvent.change(screen.getByLabelText(REMOTE_PERFORMANCE_PATH_LABEL), { target: { value: '' } });
        fireEvent.click(getButtonWithText('Run tests'));

        // An unconfigured path has nothing to search, so a row promising otherwise
        // would wait on a result the server never sends for it.
        expect(screen.getByText('Searching for memory reports')).toBeInTheDocument();
        expect(screen.queryByText('Searching for performance reports')).not.toBeInTheDocument();

        resolveTest(PASSING_TESTS);
        await waitFor(() => expect(screen.getByText('Found 3 memory reports')).toBeInTheDocument());
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
        fireEvent.change(screen.getByLabelText(SSH_HOST_LABEL), { target: { value: 'other-host' } });
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
        [SSH_HOST_LABEL, 'other-host'],
        [SSH_USERNAME_LABEL, 'carol'],
        [SSH_PORT_LABEL, '2022'],
        [REMOTE_MEMORY_PATH_LABEL, '/elsewhere'],
        [REMOTE_PERFORMANCE_PATH_LABEL, '/elsewhere-perf'],
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
        fireEvent.change(screen.getByLabelText(SSH_HOST_LABEL), { target: { value: 'work-gpu' } });
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

        fireEvent.change(screen.getByLabelText(CONNECTION_NAME_LABEL), { target: { value: 'renamed box' } });

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

        fireEvent.change(screen.getByLabelText(SSH_CONFIG_HOST_SUBLABEL), { target: { value: 'work-gpu' } });
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

describe('RemoteConnectionDialog remote path validation', () => {
    // The backend refuses a relative path, so catching it here keeps the user in the
    // form instead of sending a request that comes back as "Invalid connection data".
    it.each([
        [REMOTE_MEMORY_PATH_LABEL, 'tt-metal/generated/ttnn/reports'],
        [REMOTE_PERFORMANCE_PATH_LABEL, '~/tt-metal/generated/profiler/reports'],
    ])('reports a path that is not absolute on %s', (label, value) => {
        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        const input = screen.getByLabelText(label);
        fireEvent.change(input, { target: { value } });

        // Asserted as the input's description rather than as text on the page: Blueprint
        // only colours the field, so the message reaches a screen reader solely through
        // the aria-describedby the dialog wires up itself.
        expect(input).toHaveAccessibleDescription(REMOTE_PATH_NOT_ABSOLUTE_ERROR);
        expect(input).toBeInvalid();
        expect(getButtonWithText('Run tests')).toBeDisabled();
    });

    it('does not run the connection test while a path is invalid', () => {
        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        fireEvent.change(screen.getByLabelText(REMOTE_MEMORY_PATH_LABEL), {
            target: { value: 'reports' },
        });
        fireEvent.click(getButtonWithText('Run tests'));

        expect(testConnectionMock).not.toHaveBeenCalled();
    });

    it('clears the error once the path is made absolute', () => {
        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        const input = screen.getByLabelText(REMOTE_MEMORY_PATH_LABEL);
        fireEvent.change(input, { target: { value: 'reports' } });
        expect(input).toHaveAccessibleDescription(REMOTE_PATH_NOT_ABSOLUTE_ERROR);

        fireEvent.change(input, { target: { value: '/reports' } });

        expect(input).not.toHaveAccessibleDescription(REMOTE_PATH_NOT_ABSOLUTE_ERROR);
        expect(input).toBeValid();
        expect(getButtonWithText('Run tests')).toBeEnabled();
    });

    it('leaves an unconfigured performance path unflagged', () => {
        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        const input = screen.getByLabelText(REMOTE_PERFORMANCE_PATH_LABEL);
        fireEvent.change(input, { target: { value: '' } });

        expect(input).not.toHaveAccessibleDescription(REMOTE_PATH_NOT_ABSOLUTE_ERROR);
        expect(input).toBeValid();
        expect(getButtonWithText('Run tests')).toBeEnabled();
    });

    // The list keeps a connection stored before paths had to be absolute, so this is the
    // repair route: opening it has to name the problem and leave the test — the only way to
    // re-enable saving — closed until the path is fixed. Saving is already blocked by the
    // absent test result, so `!hasPathError` in the save gate is defence in depth.
    it('names the problem and withholds the test when a stored path is no longer accepted', () => {
        render(
            <RemoteConnectionDialog
                open
                remoteConnection={{
                    name: 'legacy',
                    host: 'work-gpu',
                    port: 22,
                    username: 'bob',
                    profilerPath: 'tt-metal/generated/ttnn/reports',
                }}
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        expect(screen.getByLabelText(REMOTE_MEMORY_PATH_LABEL)).toHaveAccessibleDescription(
            REMOTE_PATH_NOT_ABSOLUTE_ERROR,
        );
        expect(getButtonWithText('Run tests')).toBeDisabled();
        expect(getButtonWithText('Add connection')).toBeDisabled();
    });

    it('re-enables the test once the stored path is corrected', () => {
        render(
            <RemoteConnectionDialog
                open
                remoteConnection={{
                    name: 'legacy',
                    host: 'work-gpu',
                    port: 22,
                    username: 'bob',
                    profilerPath: 'tt-metal/generated/ttnn/reports',
                }}
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        const input = screen.getByLabelText(REMOTE_MEMORY_PATH_LABEL);
        fireEvent.change(input, { target: { value: '/tt-metal/generated/ttnn/reports' } });

        expect(input).not.toHaveAccessibleDescription(REMOTE_PATH_NOT_ABSOLUTE_ERROR);
        expect(input).toBeValid();
        expect(getButtonWithText('Run tests')).toBeEnabled();
    });
});

describe('RemoteConnectionDialog connection test error handling', () => {
    // A rejected field returns `{ error: … }`, not a status list. Casting that to an
    // array reached `.map` as a non-array and took the dialog down with it.
    it('falls back to a rendered failure when the error body is not a status list', async () => {
        testConnectionMock.mockRejectedValue({
            isAxiosError: true,
            response: { status: 400, data: { error: 'Invalid connection data' } },
        });

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        fireEvent.click(getButtonWithText('Run tests'));

        await waitFor(() => expect(screen.getByText('Connection failed')).toBeInTheDocument());
        expect(screen.getByText('Invalid connection data')).toBeInTheDocument();
        expect(getButtonWithText('Add connection')).toBeDisabled();
    });

    it('renders a status list returned as an error body', async () => {
        testConnectionMock.mockRejectedValue({
            isAxiosError: true,
            response: {
                status: 422,
                data: [{ status: ConnectionTestStates.FAILED, message: 'SSH authentication failed' }],
            },
        });

        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
        );

        fireEvent.click(getButtonWithText('Run tests'));

        await waitFor(() => expect(screen.getByText('SSH authentication failed')).toBeInTheDocument());
    });
});

describe('RemoteConnectionDialog host key failures', () => {
    const FINGERPRINT = 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU';

    const hostKeyFailure = (hostKey: HostKeyStatus, message = 'SSH host key is not in ~/.ssh/known_hosts') => ({
        isAxiosError: true,
        response: {
            status: 422,
            data: [{ status: ConnectionTestStates.FAILED, message, hostKey }],
        },
    });

    const renderDialog = () =>
        render(
            <RemoteConnectionDialog
                open
                onClose={vi.fn()}
                onAddConnection={vi.fn()}
            />,
            { wrapper: QueryProvider },
        );

    it('offers the fingerprint and a trust action for an unknown key', async () => {
        testConnectionMock.mockRejectedValue(
            hostKeyFailure({ issue: HostKeyIssue.UNKNOWN, host: 'aus-wh-05', port: 2222 }),
        );
        fetchHostKeyOfferMock.mockResolvedValue({
            issue: HostKeyIssue.UNKNOWN,
            host: 'aus-wh-05',
            port: 2222,
            offers: [{ keyType: 'ssh-ed25519', fingerprint: FINGERPRINT, line: 'line' }],
        });

        renderDialog();
        fireEvent.click(getButtonWithText('Run tests'));

        await waitFor(() => expect(screen.getByText(FINGERPRINT)).toBeInTheDocument());
        expect(screen.getByTestId(TEST_IDS.HOST_KEY_TRUST_BUTTON)).toBeInTheDocument();
        // Still a FAILED line, so the connection cannot be saved on the strength of it.
        expect(getButtonWithText('Add connection')).toBeDisabled();
    });

    it('re-runs the test after trusting, so the save gate sees a fresh result', async () => {
        testConnectionMock.mockRejectedValueOnce(
            hostKeyFailure({ issue: HostKeyIssue.UNKNOWN, host: 'aus-wh-05', port: 2222 }),
        );
        fetchHostKeyOfferMock.mockResolvedValue({
            issue: HostKeyIssue.UNKNOWN,
            host: 'aus-wh-05',
            port: 2222,
            offers: [{ keyType: 'ssh-ed25519', fingerprint: FINGERPRINT, line: 'line' }],
        });
        trustHostKeyMock.mockResolvedValue(undefined);
        testConnectionMock.mockResolvedValue([
            { status: ConnectionTestStates.OK, message: 'SSH connection established' },
        ]);

        renderDialog();
        fireEvent.click(getButtonWithText('Run tests'));

        await waitFor(() => expect(screen.getByTestId(TEST_IDS.HOST_KEY_TRUST_BUTTON)).toBeInTheDocument());
        fireEvent.click(screen.getByTestId(TEST_IDS.HOST_KEY_TRUST_BUTTON));

        await waitFor(() => expect(trustHostKeyMock).toHaveBeenCalled());
        // Trusting clears one reason the test failed, not necessarily the only one, so the
        // verdict has to come from a real re-run rather than from assuming success.
        await waitFor(() => expect(screen.getByText('SSH connection established')).toBeInTheDocument());
        expect(testConnectionMock).toHaveBeenCalledTimes(2);
    });

    it('trusts against the host and port the form holds', async () => {
        testConnectionMock.mockRejectedValue(
            hostKeyFailure({ issue: HostKeyIssue.UNKNOWN, host: 'resolved.example', port: 2222 }),
        );
        fetchHostKeyOfferMock.mockResolvedValue({
            issue: HostKeyIssue.UNKNOWN,
            host: 'resolved.example',
            port: 2222,
            offers: [{ keyType: 'ssh-ed25519', fingerprint: FINGERPRINT, line: 'line' }],
        });
        trustHostKeyMock.mockResolvedValue(undefined);

        renderDialog();
        fireEvent.change(screen.getByLabelText(SSH_HOST_LABEL), { target: { value: 'lab' } });
        fireEvent.click(getButtonWithText('Run tests'));

        await waitFor(() => expect(screen.getByTestId(TEST_IDS.HOST_KEY_TRUST_BUTTON)).toBeInTheDocument());
        fireEvent.click(screen.getByTestId(TEST_IDS.HOST_KEY_TRUST_BUTTON));

        // The alias the user typed, not the resolved name on the verdict: the backend has
        // to redo the same resolution the connection will, and needs identityFile for it.
        await waitFor(() =>
            expect(trustHostKeyMock).toHaveBeenCalledWith(expect.objectContaining({ host: 'lab', port: 2222 }), [
                FINGERPRINT,
            ]),
        );
    });

    it('withholds the trust action when the key has changed', async () => {
        testConnectionMock.mockRejectedValue(
            hostKeyFailure(
                {
                    issue: HostKeyIssue.CHANGED,
                    host: 'aus-wh-05',
                    port: 2222,
                    knownHostsEntry: '/home/u/.ssh/known_hosts:3',
                    removalCommand: "ssh-keygen -R '[aus-wh-05]:2222'",
                },
                'The SSH host key has changed',
            ),
        );

        renderDialog();
        fireEvent.click(getButtonWithText('Run tests'));

        await waitFor(() => expect(screen.getByText('The SSH host key has changed')).toBeInTheDocument());
        expect(screen.queryByTestId(TEST_IDS.HOST_KEY_TRUST_BUTTON)).not.toBeInTheDocument();
        expect(screen.getByText("ssh-keygen -R '[aus-wh-05]:2222'")).toBeInTheDocument();
        expect(fetchHostKeyOfferMock).not.toHaveBeenCalled();
    });

    it('hides the trust affordance under SERVER_MODE', async () => {
        getServerConfigMock.mockReturnValue({ ...SERVER_CONFIG, SERVER_MODE: true });
        testConnectionMock.mockRejectedValue(
            hostKeyFailure({ issue: HostKeyIssue.UNKNOWN, host: 'aus-wh-05', port: 2222 }),
        );

        renderDialog();
        fireEvent.click(getButtonWithText('Run tests'));

        await waitFor(() => expect(screen.getByText('SSH host key is not in ~/.ssh/known_hosts')).toBeInTheDocument());
        expect(screen.queryByTestId(TEST_IDS.HOST_KEY_PROMPT)).not.toBeInTheDocument();
    });

    it('ignores a malformed host key payload rather than rendering a broken prompt', async () => {
        testConnectionMock.mockRejectedValue({
            isAxiosError: true,
            response: {
                status: 422,
                data: [
                    {
                        status: ConnectionTestStates.FAILED,
                        message: 'SSH connection failed',
                        hostKey: { issue: 'nonsense' },
                    },
                ],
            },
        });

        renderDialog();
        fireEvent.click(getButtonWithText('Run tests'));

        await waitFor(() => expect(screen.getByText('SSH connection failed')).toBeInTheDocument());
        expect(screen.queryByTestId(TEST_IDS.HOST_KEY_PROMPT)).not.toBeInTheDocument();
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
