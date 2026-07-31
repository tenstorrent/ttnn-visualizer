// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAtomValue, useSetAtom } from 'jotai';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MLIRFileSelector from '../src/components/report-selection/MLIRFileSelector';
import { ConnectionStatus, ConnectionTestStates } from '../src/definitions/ConnectionStatus';
import { CANCEL_DELETE_LABEL, CONFIRM_DELETE_LABEL, ManagedEntity } from '../src/definitions/ManagedEntity';
import { MlirServerConnection } from '../src/definitions/MlirServer';
import { TEST_IDS } from '../src/definitions/TestIds';
import { getDeleteActionLabel, getEditActionLabel } from '../src/functions/managedEntityLabels';
import { GraphBundle } from '../src/model/MLIRJsonModel';
import { isActivatingReportAtom, mlirFileResultsAtom, mlirServersAtom, selectedMlirServerAtom } from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';
import testForPortal from './helpers/testForPortal';

const testMlirServerConnectionMock = vi.hoisted(() => vi.fn<() => Promise<ConnectionStatus[]>>());

vi.mock('../src/hooks/useMlirRemote', () => ({
    default: () => ({
        uploadMlirFileToServer: vi.fn(),
        testMlirServerConnection: testMlirServerConnectionMock,
    }),
}));

const SERVER: MlirServerConnection = {
    name: 'Test host',
    username: 'tt',
    host: 'worker-01',
    sshPort: 22,
    port: 8080,
};

const OTHER_SERVER: MlirServerConnection = {
    name: 'Other host',
    username: 'tt',
    host: 'worker-02',
    sshPort: 22,
    port: 8081,
};

const GRAPH: GraphBundle = { graphs: [{ id: 'g', nodes: [] }] };

/** The dialog only enables its save button once a connection test has come back clean. */
const PASSING_TESTS: ConnectionStatus[] = [{ status: ConnectionTestStates.OK, message: 'MLIR server reachable' }];

const WAIT_FOR_OPTIONS = { timeout: 1000 };
const SELECTED_SERVER_TEST_ID = 'selected-server-probe';
const START_ACTIVATING_LABEL = 'Start activating';
const SAVE_SERVER_LABEL = 'Save server';
const EDITED_NAME = 'Renamed host';

const editLabel = (server: MlirServerConnection) => getEditActionLabel(ManagedEntity.MLIR_SERVER, server.name);
const deleteLabel = (server: MlirServerConnection) => getDeleteActionLabel(ManagedEntity.MLIR_SERVER, server.name);

const SelectedServerProbe = () => (
    <span data-testid={SELECTED_SERVER_TEST_ID}>{useAtomValue(selectedMlirServerAtom)?.name ?? 'none'}</span>
);

/** Report activation is driven by an atom, so flip it from inside the tree rather than remounting. */
const StartActivatingButton = () => {
    const setIsActivatingReport = useSetAtom(isActivatingReportAtom);

    return (
        <button
            type='button'
            onClick={() => setIsActivatingReport(true)}
        >
            {START_ACTIVATING_LABEL}
        </button>
    );
};

/**
 * Anchored on the formatted server string so it matches the Select trigger only — row action
 * labels carry the server name too, and an unanchored pattern matches those as well.
 */
const serverTriggerName = (server: MlirServerConnection) => new RegExp(`^${server.name} — ssh`);

/** Row actions only exist while the Select popover is open; the trigger shows the server in use. */
const openServerDropdown = async (server: MlirServerConnection = SERVER) => {
    fireEvent.click(screen.getByRole('button', { name: serverTriggerName(server) }));
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);
};

/** Rename the open dialog's server and save it, which needs a passing test result first. */
const runTestAndSave = async () => {
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: EDITED_NAME } });
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }));

    await waitFor(() => expect(screen.getByRole('button', { name: SAVE_SERVER_LABEL })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: SAVE_SERVER_LABEL }));
};

afterEach(() => {
    cleanup();
    window.localStorage.clear();
});

beforeEach(() => {
    testMlirServerConnectionMock.mockClear();
    testMlirServerConnectionMock.mockResolvedValue(PASSING_TESTS);
});

it('disables MLIR inputs while an active report is being confirmed', () => {
    render(
        <TestProviders
            initialAtomValues={[
                [mlirServersAtom, [SERVER]],
                [selectedMlirServerAtom, SERVER],
                [isActivatingReportAtom, true],
                [
                    mlirFileResultsAtom,
                    [
                        {
                            filename: 'a.mlir',
                            name: 'a',
                            status: ConnectionTestStates.OK,
                            graph: GRAPH,
                            persisted: true,
                        },
                    ],
                ],
            ]}
        >
            <MLIRFileSelector />
        </TestProviders>,
    );

    expect(screen.getByRole('button', { name: /add new server/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /test host/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /view mlir uploads/i })).toBeDisabled();

    const fileInput = document.querySelector('.file-loader input');
    expect(fileInput).not.toBeNull();
    expect(fileInput).toBeDisabled();
});

it('enables MLIR inputs when no report activation is in progress', () => {
    render(
        <TestProviders
            initialAtomValues={[
                [mlirServersAtom, [SERVER]],
                [selectedMlirServerAtom, SERVER],
                [isActivatingReportAtom, false],
                [
                    mlirFileResultsAtom,
                    [
                        {
                            filename: 'a.mlir',
                            name: 'a',
                            status: ConnectionTestStates.OK,
                            graph: GRAPH,
                            persisted: true,
                        },
                    ],
                ],
            ]}
        >
            <MLIRFileSelector />
        </TestProviders>,
    );

    expect(screen.getByRole('button', { name: /add new server/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /test host/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /view mlir uploads/i })).toBeEnabled();

    const fileInput = document.querySelector('.file-loader input');
    expect(fileInput).not.toBeNull();
    expect(fileInput).toBeEnabled();
});

it('leaves no reachable row action once an active report is being confirmed', async () => {
    render(
        <TestProviders
            initialAtomValues={[
                [mlirServersAtom, [SERVER, OTHER_SERVER]],
                [selectedMlirServerAtom, SERVER],
                [isActivatingReportAtom, false],
            ]}
        >
            <MLIRFileSelector />
            <StartActivatingButton />
        </TestProviders>,
    );

    await openServerDropdown();

    // Establish the rows are reachable first, so the assertion after activating cannot pass simply
    // because nothing ever rendered.
    expect(screen.getAllByTestId(TEST_IDS.MLIR_SERVER_ROW)).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: START_ACTIVATING_LABEL }));

    // Blueprint empties the item list of a disabled Select, so an open popover loses its rows.
    expect(screen.queryAllByTestId(TEST_IDS.MLIR_SERVER_ROW)).toHaveLength(0);
    expect(screen.getByRole('button', { name: serverTriggerName(SERVER) })).toBeDisabled();
});

it('removes the server whose row was clicked once the delete is confirmed', async () => {
    render(
        <TestProviders
            initialAtomValues={[
                [mlirServersAtom, [SERVER, OTHER_SERVER]],
                [selectedMlirServerAtom, SERVER],
            ]}
        >
            <MLIRFileSelector />
            <SelectedServerProbe />
        </TestProviders>,
    );

    await openServerDropdown();

    fireEvent.click(screen.getByLabelText(deleteLabel(OTHER_SERVER)));

    expect(screen.getByText(/Are you sure you want to delete the MLIR server/)).toHaveTextContent(OTHER_SERVER.name);
    fireEvent.click(screen.getByRole('button', { name: CONFIRM_DELETE_LABEL }));

    // The selected server is untouched because the removed row was a different server.
    expect(screen.getByTestId(SELECTED_SERVER_TEST_ID)).toHaveTextContent(SERVER.name);

    await openServerDropdown();
    expect(screen.getAllByTestId(TEST_IDS.MLIR_SERVER_ROW)).toHaveLength(1);
    expect(screen.queryByLabelText(deleteLabel(OTHER_SERVER))).toBeNull();
});

it('keeps the server list unchanged when the delete is cancelled', async () => {
    render(
        <TestProviders
            initialAtomValues={[
                [mlirServersAtom, [SERVER, OTHER_SERVER]],
                [selectedMlirServerAtom, SERVER],
            ]}
        >
            <MLIRFileSelector />
            <SelectedServerProbe />
        </TestProviders>,
    );

    await openServerDropdown();

    fireEvent.click(screen.getByLabelText(deleteLabel(SERVER)));
    fireEvent.click(screen.getByRole('button', { name: CANCEL_DELETE_LABEL }));

    expect(screen.getByTestId(SELECTED_SERVER_TEST_ID)).toHaveTextContent(SERVER.name);

    await openServerDropdown();
    expect(screen.getAllByTestId(TEST_IDS.MLIR_SERVER_ROW)).toHaveLength(2);
});

it('moves the selection on when the server in use is removed', async () => {
    render(
        <TestProviders
            initialAtomValues={[
                [mlirServersAtom, [SERVER, OTHER_SERVER]],
                [selectedMlirServerAtom, SERVER],
            ]}
        >
            <MLIRFileSelector />
            <SelectedServerProbe />
        </TestProviders>,
    );

    await openServerDropdown();

    fireEvent.click(screen.getByLabelText(deleteLabel(SERVER)));
    fireEvent.click(screen.getByRole('button', { name: CONFIRM_DELETE_LABEL }));

    expect(screen.getByTestId(SELECTED_SERVER_TEST_ID)).toHaveTextContent(OTHER_SERVER.name);
});

it('seeds the edit dialog from the row that was clicked', async () => {
    render(
        <TestProviders
            initialAtomValues={[
                [mlirServersAtom, [SERVER, OTHER_SERVER]],
                [selectedMlirServerAtom, SERVER],
            ]}
        >
            <MLIRFileSelector />
        </TestProviders>,
    );

    await openServerDropdown();

    fireEvent.click(screen.getByLabelText(editLabel(OTHER_SERVER)));

    expect(screen.getByText('Edit MLIR server')).not.toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe(OTHER_SERVER.name);
});

it('keeps the server in use when a different row is edited and saved', async () => {
    render(
        <TestProviders
            initialAtomValues={[
                [mlirServersAtom, [SERVER, OTHER_SERVER]],
                [selectedMlirServerAtom, SERVER],
            ]}
        >
            <MLIRFileSelector />
            <SelectedServerProbe />
        </TestProviders>,
    );

    await openServerDropdown();

    fireEvent.click(screen.getByLabelText(editLabel(OTHER_SERVER)));
    await runTestAndSave();

    expect(screen.getByTestId(SELECTED_SERVER_TEST_ID)).toHaveTextContent(SERVER.name);

    // Only the edited row changed, so the rename must land on that row and no other.
    await openServerDropdown();
    expect(screen.getByLabelText(editLabel({ ...OTHER_SERVER, name: EDITED_NAME }))).toBeInTheDocument();
    expect(screen.getByLabelText(editLabel(SERVER))).toBeInTheDocument();
});

it('follows the rename when the server in use is edited and saved', async () => {
    render(
        <TestProviders
            initialAtomValues={[
                [mlirServersAtom, [SERVER, OTHER_SERVER]],
                [selectedMlirServerAtom, SERVER],
            ]}
        >
            <MLIRFileSelector />
            <SelectedServerProbe />
        </TestProviders>,
    );

    await openServerDropdown();

    fireEvent.click(screen.getByLabelText(editLabel(SERVER)));
    await runTestAndSave();

    expect(screen.getByTestId(SELECTED_SERVER_TEST_ID)).toHaveTextContent(EDITED_NAME);
});
