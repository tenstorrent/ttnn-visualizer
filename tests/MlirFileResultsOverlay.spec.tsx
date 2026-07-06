// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MlirFileResultsOverlay from '../src/components/mlir/MlirFileResultsOverlay';
import MlirJsonFileLoader from '../src/components/mlir/MlirJsonFileLoader';
import { ConnectionTestStates } from '../src/definitions/ConnectionStatus';
import {
    activeMlirDataAtom,
    activeMlirJsonAtom,
    mlirFileResultsAtom,
    mlirFileResultsOpenAtom,
    mlirRetryFilesAtom,
    mlirRetryServerAtom,
} from '../src/store/app';
import { GraphBundle, MlirFileResult } from '../src/model/MLIRJsonModel';
import { MlirServerConnection } from '../src/definitions/MlirServer';

const setActiveMlir = vi.fn();
const uploadMlirFileToServer = vi.fn();
const { createToastNotification } = vi.hoisted(() => ({
    createToastNotification: vi.fn(),
}));

vi.mock('../src/hooks/useMlirRemote', () => ({
    default: () => ({ setActiveMlir, uploadMlirFileToServer }),
}));

vi.mock('../src/functions/createToastNotification', () => ({
    default: createToastNotification,
    ToastType: { SUCCESS: 'success', WARNING: 'warning', ERROR: 'error' },
}));

const GRAPH: GraphBundle = { graphs: [{ id: 'g', nodes: [] }] };
const SERVER: MlirServerConnection = {
    name: 'Test host',
    username: 'tt',
    host: 'worker-01',
    sshPort: 22,
    port: 8080,
};

function renderOverlay(results: MlirFileResult[]) {
    getDefaultStore().set(mlirFileResultsAtom, results);
    getDefaultStore().set(mlirFileResultsOpenAtom, true);
    return render(
        <MemoryRouter>
            <MlirFileResultsOverlay />
        </MemoryRouter>,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    getDefaultStore().set(mlirFileResultsAtom, null);
    getDefaultStore().set(mlirFileResultsOpenAtom, false);
    getDefaultStore().set(mlirRetryFilesAtom, null);
    getDefaultStore().set(mlirRetryServerAtom, null);
    getDefaultStore().set(activeMlirDataAtom, null);
    getDefaultStore().set(activeMlirJsonAtom, null);
});

afterEach(() => cleanup());

describe('MlirFileResultsOverlay', () => {
    it('lists each uploaded file with its outcome', () => {
        renderOverlay([
            { filename: 'a.mlir', name: 'a', status: ConnectionTestStates.OK, graph: GRAPH, persisted: true },
            {
                filename: 'b.mlir',
                name: null,
                status: ConnectionTestStates.FAILED,
                message: 'Conversion failed',
                graph: null,
                persisted: true,
            },
        ]);

        expect(screen.getByText('a.mlir')).toBeInTheDocument();
        expect(screen.getByText('b.mlir')).toBeInTheDocument();
        expect(screen.getByText('Conversion failed')).toBeInTheDocument();
    });

    it('keeps View disabled until a file is selected', () => {
        renderOverlay([
            {
                filename: 'a.mlir',
                host: 'worker-01',
                name: 'a',
                status: ConnectionTestStates.OK,
                graph: GRAPH,
                persisted: true,
            },
        ]);

        expect(screen.getByRole('button', { name: /view/i })).toBeDisabled();

        fireEvent.click(screen.getByText('a.mlir'));

        expect(screen.getByRole('button', { name: /view/i })).toBeEnabled();
    });

    it('activates and persists the selected server file via View, then closes the overlay', async () => {
        renderOverlay([
            {
                filename: 'a.mlir',
                host: 'worker-01',
                name: 'a',
                status: ConnectionTestStates.OK,
                graph: GRAPH,
                persisted: true,
            },
        ]);

        fireEvent.click(screen.getByText('a.mlir'));
        fireEvent.click(screen.getByRole('button', { name: /view/i }));

        await waitFor(() => {
            expect(getDefaultStore().get(activeMlirDataAtom)).toEqual(GRAPH);
        });
        expect(getDefaultStore().get(activeMlirJsonAtom)).toBe('a');
        expect(setActiveMlir).toHaveBeenCalledWith('a', 'worker-01');
        // The overlay closes but the results are retained so it can be reopened.
        expect(getDefaultStore().get(mlirFileResultsOpenAtom)).toBe(false);
        expect(getDefaultStore().get(mlirFileResultsAtom)).not.toBeNull();
    });

    it('reopens the results overlay via the loader button after it has been closed', async () => {
        getDefaultStore().set(mlirFileResultsAtom, [
            { filename: 'a.json', name: 'a', status: ConnectionTestStates.OK, graph: GRAPH, persisted: false },
        ]);
        getDefaultStore().set(mlirFileResultsOpenAtom, false);

        render(
            <MemoryRouter>
                <MlirJsonFileLoader />
                <MlirFileResultsOverlay />
            </MemoryRouter>,
        );

        // Closed: results retained but the overlay is not shown.
        expect(screen.queryByText('MLIR uploads')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /view mlir uploads/i }));

        await waitFor(() => {
            expect(screen.getByText('MLIR uploads')).toBeInTheDocument();
        });
    });

    it('does not persist a local (in-memory) file selection', async () => {
        renderOverlay([
            { filename: 'a.json', name: 'a', status: ConnectionTestStates.OK, graph: GRAPH, persisted: false },
        ]);

        fireEvent.click(screen.getByText('a.json'));
        fireEvent.click(screen.getByRole('button', { name: /view/i }));

        await waitFor(() => {
            expect(getDefaultStore().get(activeMlirDataAtom)).toEqual(GRAPH);
        });
        expect(setActiveMlir).not.toHaveBeenCalled();
    });

    it('does not show a success toast when persisting active MLIR fails', async () => {
        setActiveMlir.mockRejectedValueOnce(new Error('persist failed'));
        renderOverlay([
            {
                filename: 'a.mlir',
                host: 'worker-01',
                name: 'a',
                status: ConnectionTestStates.OK,
                graph: GRAPH,
                persisted: true,
            },
        ]);

        fireEvent.click(screen.getByText('a.mlir'));
        fireEvent.click(screen.getByRole('button', { name: /view/i }));

        await waitFor(() => {
            expect(setActiveMlir).toHaveBeenCalledWith('a', 'worker-01');
        });
        expect(createToastNotification).toHaveBeenCalledTimes(1);
        expect(createToastNotification).toHaveBeenCalledWith('MLIR', 'persist failed', 'error');
    });

    it('retries conversion for a failed server file', async () => {
        const failedFile = new File(['module {}'], 'failed.mlir');
        getDefaultStore().set(mlirRetryFilesAtom, [failedFile]);
        getDefaultStore().set(mlirRetryServerAtom, SERVER);
        uploadMlirFileToServer.mockResolvedValueOnce({
            data: {
                results: [
                    {
                        filename: 'failed.mlir',
                        name: 'failed',
                        status: ConnectionTestStates.OK,
                        graph: GRAPH,
                    },
                ],
            },
        });

        renderOverlay([
            {
                filename: 'failed.mlir',
                name: null,
                status: ConnectionTestStates.FAILED,
                message: 'Conversion failed',
                graph: null,
                persisted: true,
            },
        ]);

        fireEvent.click(screen.getByRole('button', { name: /retry/i }));

        await waitFor(() => {
            expect(uploadMlirFileToServer).toHaveBeenCalledWith(
                [failedFile],
                SERVER,
                expect.objectContaining({ signal: expect.any(AbortSignal) }),
            );
            expect(getDefaultStore().get(mlirFileResultsAtom)?.[0]).toMatchObject({
                status: ConnectionTestStates.OK,
                name: 'failed',
                graph: GRAPH,
            });
        });
    });

    it('keeps View disabled for failed rows while allowing Retry', async () => {
        const failedFile = new File(['module {}'], 'failed.mlir');
        getDefaultStore().set(mlirRetryFilesAtom, [failedFile]);
        getDefaultStore().set(mlirRetryServerAtom, SERVER);
        uploadMlirFileToServer.mockResolvedValueOnce({
            data: {
                results: [
                    {
                        filename: 'failed.mlir',
                        name: null,
                        status: ConnectionTestStates.FAILED,
                        message: 'Still failing',
                        graph: null,
                    },
                ],
            },
        });

        renderOverlay([
            {
                filename: 'failed.mlir',
                name: null,
                status: ConnectionTestStates.FAILED,
                message: 'Conversion failed',
                graph: null,
                persisted: true,
            },
        ]);

        const viewButton = screen.getByRole('button', { name: /view/i });
        const retryButton = screen.getByRole('button', { name: /retry/i });
        expect(viewButton).toBeDisabled();
        expect(retryButton).toBeEnabled();

        // Failed rows must remain non-selectable for View.
        fireEvent.click(screen.getByText('failed.mlir'));
        expect(viewButton).toBeDisabled();

        fireEvent.click(retryButton);

        await waitFor(() => {
            expect(uploadMlirFileToServer).toHaveBeenCalledWith(
                [failedFile],
                SERVER,
                expect.objectContaining({ signal: expect.any(AbortSignal) }),
            );
            expect(viewButton).toBeDisabled();
        });
    });

    it('does not render Retry when retry context is missing', () => {
        renderOverlay([
            {
                filename: 'failed.mlir',
                name: null,
                status: ConnectionTestStates.FAILED,
                message: 'Conversion failed',
                graph: null,
                persisted: true,
            },
        ]);

        expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    it('allows retries for different rows in parallel', async () => {
        const fileA = new File(['module {}'], 'failed-a.mlir');
        const fileB = new File(['module {}'], 'failed-b.mlir');
        getDefaultStore().set(mlirRetryFilesAtom, [fileA, fileB]);
        getDefaultStore().set(mlirRetryServerAtom, SERVER);

        let resolveRetryA: (value: unknown) => void = () => undefined;
        let resolveRetryB: (value: unknown) => void = () => undefined;
        uploadMlirFileToServer
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveRetryA = resolve;
                    }),
            )
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveRetryB = resolve;
                    }),
            );

        renderOverlay([
            {
                filename: 'failed-a.mlir',
                name: null,
                status: ConnectionTestStates.FAILED,
                message: 'Conversion failed',
                graph: null,
                persisted: true,
            },
            {
                filename: 'failed-b.mlir',
                name: null,
                status: ConnectionTestStates.FAILED,
                message: 'Conversion failed',
                graph: null,
                persisted: true,
            },
        ]);

        const [firstRetryButton, secondRetryButton] = screen.getAllByRole('button', { name: /retry/i });
        fireEvent.click(firstRetryButton);

        await waitFor(() => {
            expect(uploadMlirFileToServer).toHaveBeenCalledTimes(1);
            expect(uploadMlirFileToServer).toHaveBeenNthCalledWith(
                1,
                [fileA],
                SERVER,
                expect.objectContaining({ signal: expect.any(AbortSignal) }),
            );
            // Row A is processing, so only row B still exposes Retry.
            const retryButtons = screen.getAllByRole('button', { name: /retry/i });
            expect(retryButtons).toHaveLength(1);
            expect(retryButtons[0]).toBeEnabled();
        });

        fireEvent.click(secondRetryButton);

        await waitFor(() => {
            expect(uploadMlirFileToServer).toHaveBeenCalledTimes(2);
            expect(uploadMlirFileToServer).toHaveBeenNthCalledWith(
                2,
                [fileB],
                SERVER,
                expect.objectContaining({ signal: expect.any(AbortSignal) }),
            );
            // Both rows are now processing, so no Retry buttons are visible.
            expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
        });

        resolveRetryA({
            data: {
                results: [
                    {
                        filename: 'failed-a.mlir',
                        name: null,
                        status: ConnectionTestStates.FAILED,
                        message: 'Still failing',
                        graph: null,
                    },
                ],
            },
        });
        resolveRetryB({
            data: {
                results: [
                    {
                        filename: 'failed-b.mlir',
                        name: null,
                        status: ConnectionTestStates.FAILED,
                        message: 'Still failing',
                        graph: null,
                    },
                ],
            },
        });

        await waitFor(() => {
            const retryButtons = screen.getAllByRole('button', { name: /retry/i });
            expect(retryButtons).toHaveLength(2);
            expect(retryButtons[0]).toBeEnabled();
            expect(retryButtons[1]).toBeEnabled();
        });
    });

    it('cancels in-progress retry writeback when the overlay closes', async () => {
        const failedFile = new File(['module {}'], 'failed.mlir');
        getDefaultStore().set(mlirRetryFilesAtom, [failedFile]);
        getDefaultStore().set(mlirRetryServerAtom, SERVER);

        let resolveRetry: (value: unknown) => void = () => undefined;
        uploadMlirFileToServer.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveRetry = resolve;
                }),
        );
        let retrySignal: AbortSignal | undefined;

        renderOverlay([
            {
                filename: 'failed.mlir',
                name: null,
                status: ConnectionTestStates.FAILED,
                message: 'Conversion failed',
                graph: null,
                persisted: true,
            },
        ]);

        fireEvent.click(screen.getByRole('button', { name: /retry/i }));

        await waitFor(() => {
            expect(uploadMlirFileToServer).toHaveBeenCalledWith(
                [failedFile],
                SERVER,
                expect.objectContaining({ signal: expect.any(AbortSignal) }),
            );
            retrySignal = uploadMlirFileToServer.mock.calls[0]?.[2]?.signal;
        });

        fireEvent.click(screen.getByRole('button', { name: /close/i }));

        await waitFor(() => {
            expect(getDefaultStore().get(mlirFileResultsOpenAtom)).toBe(false);
            expect(retrySignal?.aborted).toBe(true);
            expect(createToastNotification).toHaveBeenCalledWith('MLIR', 'Aborted 1x MLIR conversion', 'warning');
        });

        resolveRetry({
            data: {
                results: [
                    {
                        filename: 'failed.mlir',
                        name: 'failed',
                        status: ConnectionTestStates.OK,
                        graph: GRAPH,
                    },
                ],
            },
        });

        await waitFor(() => {
            expect(getDefaultStore().get(mlirFileResultsAtom)?.[0]).toMatchObject({
                status: ConnectionTestStates.FAILED,
                name: null,
                graph: null,
            });
        });
    });
});
