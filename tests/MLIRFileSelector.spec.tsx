// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { afterEach, expect, it, vi } from 'vitest';
import MLIRFileSelector from '../src/components/report-selection/MLIRFileSelector';
import { ConnectionTestStates } from '../src/definitions/ConnectionStatus';
import { EDIT_SERVER_LABEL, MlirServerConnection, REMOVE_SERVER_LABEL } from '../src/definitions/MlirServer';
import { GraphBundle } from '../src/model/MLIRJsonModel';
import { isActivatingReportAtom, mlirFileResultsAtom, mlirServersAtom, selectedMlirServerAtom } from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';
import testForPortal from './helpers/testForPortal';

vi.mock('../src/hooks/useMlirRemote', () => ({
    default: () => ({
        uploadMlirFileToServer: vi.fn(),
        testMlirServerConnection: vi.fn(),
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

const WAIT_FOR_OPTIONS = { timeout: 1000 };
const SELECTED_SERVER_TEST_ID = 'selected-server-probe';

const SelectedServerProbe = () => (
    <span data-testid={SELECTED_SERVER_TEST_ID}>{useAtomValue(selectedMlirServerAtom)?.name ?? 'none'}</span>
);

/** Row actions only exist while the Select popover is open. */
const openServerDropdown = async (triggerName: RegExp) => {
    fireEvent.click(screen.getByRole('button', { name: triggerName }));
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);
};

afterEach(() => {
    cleanup();
    window.localStorage.clear();
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

it('disables the dropdown row actions while an active report is being confirmed', () => {
    render(
        <TestProviders
            initialAtomValues={[
                [mlirServersAtom, [SERVER]],
                [selectedMlirServerAtom, SERVER],
                [isActivatingReportAtom, true],
            ]}
        >
            <MLIRFileSelector />
        </TestProviders>,
    );

    // The trigger is disabled while activating, so drive the popover open directly.
    fireEvent.click(screen.getByRole('button', { name: /test host/i }));

    screen.queryAllByLabelText(EDIT_SERVER_LABEL).forEach((button) => expect(button).toBeDisabled());
    screen.queryAllByLabelText(REMOVE_SERVER_LABEL).forEach((button) => expect(button).toBeDisabled());
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

    await openServerDropdown(/test host/i);

    fireEvent.click(screen.getAllByLabelText(REMOVE_SERVER_LABEL)[1]);

    expect(screen.getByText(/Are you sure you want to delete the MLIR server/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    // The selected server is untouched because the removed row was a different server.
    expect(screen.getByTestId(SELECTED_SERVER_TEST_ID)).toHaveTextContent(SERVER.name);

    await openServerDropdown(/test host/i);
    expect(screen.queryByText(new RegExp(OTHER_SERVER.name))).toBeNull();
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

    await openServerDropdown(/test host/i);

    fireEvent.click(screen.getAllByLabelText(REMOVE_SERVER_LABEL)[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByTestId(SELECTED_SERVER_TEST_ID)).toHaveTextContent(SERVER.name);

    await openServerDropdown(/test host/i);
    expect(screen.getAllByLabelText(REMOVE_SERVER_LABEL)).toHaveLength(2);
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

    await openServerDropdown(/test host/i);

    fireEvent.click(screen.getAllByLabelText(REMOVE_SERVER_LABEL)[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

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

    await openServerDropdown(/test host/i);

    fireEvent.click(screen.getAllByLabelText(EDIT_SERVER_LABEL)[1]);

    expect(screen.getByText('Edit MLIR server')).not.toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe(OTHER_SERVER.name);
});
