// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { Classes } from '@blueprintjs/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ComponentProps } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import RemoteConnectionSelector from '../src/components/report-selection/RemoteConnectionSelector';
import { ConnectionStatus, ConnectionTestStates } from '../src/definitions/ConnectionStatus';
import { CANCEL_DELETE_LABEL, CONFIRM_DELETE_LABEL } from '../src/definitions/ManagedEntity';
import { RemoteConnection } from '../src/definitions/RemoteConnection';
import { TEST_IDS } from '../src/definitions/TestIds';
import {
    getConnectionTrigger,
    getDeleteConnectionLabel,
    getEditConnectionLabel,
} from './helpers/remoteConnectionSelectors';
import testForPortal from './helpers/testForPortal';
import { SshConfigHostsQueryResult, noSshConfigResult } from './helpers/sshConfigFixtures';

const { getServerConfigMock } = vi.hoisted(() => ({
    getServerConfigMock: vi.fn(() => ({
        SSH_DEFAULT_PORT: 2222,
        SSH_DEFAULT_PROFILER_PATH: '/mem',
        SSH_DEFAULT_PERFORMANCE_PATH: '/perf',
        USERNAME: 'bob',
        SERVER_MODE: false,
    })),
}));

const useSshConfigHostsMock = vi.hoisted(() => vi.fn<(enabled?: boolean) => SshConfigHostsQueryResult>());
const testConnectionMock = vi.hoisted(() => vi.fn<() => Promise<ConnectionStatus[]>>());

vi.mock('../src/functions/getServerConfig', () => ({ default: getServerConfigMock }));
vi.mock('../src/hooks/useSshConfigHosts', () => ({ default: useSshConfigHostsMock }));
vi.mock('../src/hooks/useRemote', () => ({
    default: () => ({ testConnection: testConnectionMock }),
}));

const FIRST_CONNECTION: RemoteConnection = {
    name: 'First',
    username: 'tt',
    host: 'worker-01',
    port: 2222,
    profilerPath: '/mem',
};

const SECOND_CONNECTION: RemoteConnection = {
    name: 'Second',
    username: 'tt',
    host: 'worker-02',
    port: 2222,
    profilerPath: '/mem',
};

/** The dialog only enables its save button once a connection test has come back clean. */
const PASSING_TESTS: ConnectionStatus[] = [
    { status: ConnectionTestStates.OK, message: 'SSH connection established' },
    { status: ConnectionTestStates.OK, message: 'Found 3 memory reports' },
];

const WAIT_FOR_OPTIONS = { timeout: 1000 };
const SAVE_CONNECTION_LABEL = 'Save connection';
const EDITED_NAME = 'Renamed';

const renderSelector = (overrides: Partial<ComponentProps<typeof RemoteConnectionSelector>> = {}) => {
    const props = {
        connectionList: [FIRST_CONNECTION, SECOND_CONNECTION],
        connection: FIRST_CONNECTION,
        disabled: false,
        loading: false,
        onSelectConnection: vi.fn(),
        onEditConnection: vi.fn(),
        onRemoveConnection: vi.fn(),
        onSyncRemoteFolderList: vi.fn(),
        ...overrides,
    };

    const { rerender } = render(<RemoteConnectionSelector {...props} />);

    return {
        ...props,
        rerenderWith: (next: Partial<ComponentProps<typeof RemoteConnectionSelector>>) =>
            rerender(
                <RemoteConnectionSelector
                    {...props}
                    {...next}
                />,
            ),
    };
};

/** Row actions only exist while the Select popover is open; the trigger shows the selection. */
const openConnectionDropdown = async (selected: RemoteConnection = FIRST_CONNECTION) => {
    fireEvent.click(getConnectionTrigger(selected));
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);
};

/** Rename the open dialog's connection and save it, which needs a passing test result first. */
const runTestsAndSave = async () => {
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: EDITED_NAME } });
    fireEvent.click(screen.getByRole('button', { name: 'Run tests' }));

    await waitFor(() => expect(screen.getByRole('button', { name: SAVE_CONNECTION_LABEL })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: SAVE_CONNECTION_LABEL }));
};

afterEach(cleanup);

beforeEach(() => {
    useSshConfigHostsMock.mockClear();
    useSshConfigHostsMock.mockReturnValue(noSshConfigResult());
    testConnectionMock.mockClear();
    testConnectionMock.mockResolvedValue(PASSING_TESTS);
});

it('renders an edit and delete action on every connection row', async () => {
    renderSelector();
    await openConnectionDropdown();

    expect(screen.getByLabelText(getEditConnectionLabel(FIRST_CONNECTION))).toBeInTheDocument();
    expect(screen.getByLabelText(getDeleteConnectionLabel(FIRST_CONNECTION))).toBeInTheDocument();
    expect(screen.getByLabelText(getEditConnectionLabel(SECOND_CONNECTION))).toBeInTheDocument();
    expect(screen.getByLabelText(getDeleteConnectionLabel(SECOND_CONNECTION))).toBeInTheDocument();
});

// Edit and delete used to be toolbar buttons outside the popover; moving them into the listbox
// makes their reachability the selector's problem. The row wrapper is presentational so the option
// stays owned by the listbox, and the actions must remain real focusable buttons inside it.
it('exposes the row actions as focusable buttons owned by the listbox', async () => {
    renderSelector();
    await openConnectionDropdown();

    const listbox = document.querySelector('[role="listbox"]');
    const deleteAction = screen.getByRole('button', { name: getDeleteConnectionLabel(FIRST_CONNECTION) });

    expect(listbox).not.toBeNull();
    expect(listbox?.querySelectorAll('[role="option"]')).toHaveLength(2);
    // A wrapper carrying a role of its own would sit between the listbox and its options.
    expect(listbox?.querySelector(`[data-testid="${TEST_IDS.REMOTE_CONNECTION_ROW}"]`)).toHaveAttribute('role', 'none');

    deleteAction.focus();

    expect(deleteAction).toHaveFocus();
    expect(deleteAction).not.toHaveAttribute('tabindex', '-1');

    fireEvent.click(deleteAction);

    expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument();
});

it('marks only the selected connection as the active row', async () => {
    renderSelector({ connection: SECOND_CONNECTION });
    await openConnectionDropdown(SECOND_CONNECTION);

    const rows = screen.getAllByTestId(TEST_IDS.REMOTE_CONNECTION_ROW);
    const activeRows = rows.filter((row) => row.querySelector(`.${Classes.ACTIVE}`) !== null);

    expect(activeRows).toHaveLength(1);
    expect(activeRows[0]).toHaveTextContent(SECOND_CONNECTION.name);
});

it('removes the connection whose row was clicked, not the selected one', async () => {
    const { onRemoveConnection } = renderSelector();
    await openConnectionDropdown();

    fireEvent.click(screen.getByLabelText(getDeleteConnectionLabel(SECOND_CONNECTION)));

    expect(screen.getByText(/Are you sure you want to delete the remote connection/)).toHaveTextContent(
        SECOND_CONNECTION.name,
    );
    fireEvent.click(screen.getByRole('button', { name: CONFIRM_DELETE_LABEL }));

    expect(onRemoveConnection).toHaveBeenCalledTimes(1);
    expect(onRemoveConnection).toHaveBeenCalledWith(SECOND_CONNECTION);
});

it('does not remove anything when the delete is cancelled', async () => {
    const { onRemoveConnection } = renderSelector();
    await openConnectionDropdown();

    fireEvent.click(screen.getByLabelText(getDeleteConnectionLabel(FIRST_CONNECTION)));
    fireEvent.click(screen.getByRole('button', { name: CANCEL_DELETE_LABEL }));

    expect(onRemoveConnection).not.toHaveBeenCalled();
});

it('warns that the cached report lists go with the connection', async () => {
    renderSelector();
    await openConnectionDropdown();

    fireEvent.click(screen.getByLabelText(getDeleteConnectionLabel(FIRST_CONNECTION)));

    expect(screen.getByText(/cached memory and performance report lists will be cleared/)).toBeInTheDocument();
});

it('seeds the edit dialog from the row that was clicked', async () => {
    renderSelector();
    await openConnectionDropdown();

    fireEvent.click(screen.getByLabelText(getEditConnectionLabel(SECOND_CONNECTION)));

    expect(screen.getByText('Edit remote connection')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue(SECOND_CONNECTION.name);
    expect(screen.getByLabelText('SSH Host')).toHaveValue(SECOND_CONNECTION.host);
});

it('applies a saved edit against the row it was opened from', async () => {
    const { onEditConnection } = renderSelector();
    await openConnectionDropdown();

    fireEvent.click(screen.getByLabelText(getEditConnectionLabel(SECOND_CONNECTION)));
    await runTestsAndSave();

    // The second argument identifies which connection to replace, so passing the selected one
    // instead would edit the wrong row.
    expect(onEditConnection).toHaveBeenCalledTimes(1);
    expect(onEditConnection).toHaveBeenCalledWith(
        expect.objectContaining({ name: EDITED_NAME, host: SECOND_CONNECTION.host }),
        SECOND_CONNECTION,
    );
});

it('does not fetch folder lists when the edited connection is not the selected one', async () => {
    const { onSyncRemoteFolderList } = renderSelector();
    await openConnectionDropdown();

    fireEvent.click(screen.getByLabelText(getEditConnectionLabel(SECOND_CONNECTION)));
    await runTestsAndSave();

    expect(onSyncRemoteFolderList).not.toHaveBeenCalled();
});

it('fetches folder lists when the edited connection is the selected one', async () => {
    const { onSyncRemoteFolderList } = renderSelector();
    await openConnectionDropdown();

    fireEvent.click(screen.getByLabelText(getEditConnectionLabel(FIRST_CONNECTION)));
    await runTestsAndSave();

    expect(onSyncRemoteFolderList).toHaveBeenCalledTimes(1);
    expect(onSyncRemoteFolderList).toHaveBeenCalledWith(expect.objectContaining({ name: EDITED_NAME }));
});

it('leaves no reachable row action once the selector is disabled', async () => {
    const { rerenderWith } = renderSelector();
    await openConnectionDropdown();

    // Establish the rows are reachable first, so the assertion after disabling cannot pass simply
    // because nothing ever rendered.
    expect(screen.getAllByTestId(TEST_IDS.REMOTE_CONNECTION_ROW)).toHaveLength(2);

    rerenderWith({ disabled: true });

    // Blueprint empties the item list of a disabled Select, so an open popover loses its rows.
    expect(screen.queryAllByTestId(TEST_IDS.REMOTE_CONNECTION_ROW)).toHaveLength(0);
    expect(getConnectionTrigger(FIRST_CONNECTION)).toBeDisabled();
});
