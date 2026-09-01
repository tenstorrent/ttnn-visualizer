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
    activeMlirJsonAtom,
    mlirFileResultsAtom,
    mlirFileResultsOpenAtom,
    mlirLoadedReportsAtom,
    mlirRetryFilesAtom,
    mlirServersAtom,
    mlirSplitViewEpochAtom,
    selectedMlirServerAtom,
} from '../src/store/app';
import { GraphBundle, MlirFileResult } from '../src/model/MLIRJsonModel';
import { MlirServerConnection } from '../src/model/MlirServer';
import { ReportKind, ReportLoadFailureReason, ReportSource } from '../src/definitions/UsageEvent';

const setActiveMlir = vi.fn();
const uploadMlirFileToServer = vi.fn();
const { createToastNotification, recordReportLoaded, recordReportLoadFailed } = vi.hoisted(() => ({
    createToastNotification: vi.fn(),
    recordReportLoaded: vi.fn(),
    recordReportLoadFailed: vi.fn(),
}));

vi.mock('../src/hooks/useMlirRemote', () => ({
    default: () => ({ setActiveMlir, uploadMlirFileToServer }),
}));

vi.mock('../src/functions/createToastNotification', async () => {
    const { toastNotificationModuleMock } = await import('./helpers/mockToastNotification');

    return toastNotificationModuleMock(createToastNotification);
});

vi.mock('../src/functions/reportLoadUsage', () => ({
    getReportLoadFailureReason: () => ReportLoadFailureReason.OTHER,
    recordReportLoaded,
    recordReportLoadFailed,
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
    getDefaultStore().set(mlirServersAtom, []);
    getDefaultStore().set(selectedMlirServerAtom, null);
    getDefaultStore().set(mlirLoadedReportsAtom, []);
    getDefaultStore().set(mlirSplitViewEpochAtom, 0);
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
            expect(getDefaultStore().get(mlirLoadedReportsAtom)).toEqual([{ name: 'a', data: GRAPH }]);
        });
        expect(getDefaultStore().get(activeMlirJsonAtom)).toBe('a');
        expect(setActiveMlir).toHaveBeenCalledWith('a', 'worker-01');
        expect(recordReportLoaded).toHaveBeenCalledWith(ReportKind.MLIR, ReportSource.UPLOAD);
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
            expect(getDefaultStore().get(mlirLoadedReportsAtom)).toEqual([{ name: 'a', data: GRAPH }]);
        });
        expect(setActiveMlir).not.toHaveBeenCalled();
        expect(recordReportLoaded).toHaveBeenCalledWith(ReportKind.MLIR, ReportSource.UPLOAD);
    });

    it('allows selecting up to two successful files and ignores a third', async () => {
        const graphB: GraphBundle = { graphs: [{ id: 'gb', nodes: [] }] };
        const graphC: GraphBundle = { graphs: [{ id: 'gc', nodes: [] }] };
        renderOverlay([
            { filename: 'a.mlir', name: 'a', status: ConnectionTestStates.OK, graph: GRAPH, persisted: false },
            { filename: 'b.mlir', name: 'b', status: ConnectionTestStates.OK, graph: graphB, persisted: false },
            { filename: 'c.mlir', name: 'c', status: ConnectionTestStates.OK, graph: graphC, persisted: false },
        ]);

        fireEvent.click(screen.getByText('a.mlir'));
        fireEvent.click(screen.getByText('b.mlir'));

        expect(screen.getByText('a.mlir').closest('a')).toHaveClass('bp6-active');
        expect(screen.getByText('b.mlir').closest('a')).toHaveClass('bp6-active');
        // At the cap, unselected success rows are disabled (not a silent no-op).
        expect(screen.getByText('c.mlir').closest('a')).toHaveAttribute('aria-disabled', 'true');

        fireEvent.click(screen.getByRole('button', { name: /view/i }));

        await waitFor(() => {
            expect(getDefaultStore().get(mlirLoadedReportsAtom)).toEqual([
                { name: 'a', data: GRAPH },
                { name: 'b', data: graphB },
            ]);
        });
    });

    it('opens two selected files as primary + peer via View', async () => {
        const graphB: GraphBundle = { graphs: [{ id: 'gb', nodes: [] }] };
        renderOverlay([
            {
                filename: 'a.mlir',
                host: 'worker-01',
                name: 'a',
                status: ConnectionTestStates.OK,
                graph: GRAPH,
                persisted: true,
            },
            {
                filename: 'b.mlir',
                host: 'worker-01',
                name: 'b',
                status: ConnectionTestStates.OK,
                graph: graphB,
                persisted: true,
            },
        ]);

        fireEvent.click(screen.getByText('a.mlir'));
        fireEvent.click(screen.getByText('b.mlir'));
        fireEvent.click(screen.getByRole('button', { name: /view/i }));

        await waitFor(() => {
            expect(getDefaultStore().get(mlirLoadedReportsAtom)).toEqual([
                { name: 'a', data: GRAPH },
                { name: 'b', data: graphB },
            ]);
        });
        expect(getDefaultStore().get(mlirSplitViewEpochAtom)).toBe(1);
        expect(getDefaultStore().get(activeMlirJsonAtom)).toBe('a');
        // Persist index 0 only — peer is session-scoped.
        expect(setActiveMlir).toHaveBeenCalledTimes(1);
        expect(setActiveMlir).toHaveBeenCalledWith('a', 'worker-01');
        expect(recordReportLoaded).toHaveBeenCalledTimes(2);
        expect(createToastNotification).toHaveBeenCalledWith('MLIR', 'a.mlir / b.mlir', 'success');
    });

    it('replaces a prior peer when View commits a single file', async () => {
        const graphB: GraphBundle = { graphs: [{ id: 'gb', nodes: [] }] };
        getDefaultStore().set(mlirLoadedReportsAtom, [
            { name: 'a', data: GRAPH },
            { name: 'b', data: graphB },
        ]);

        renderOverlay([
            { filename: 'a.json', name: 'a', status: ConnectionTestStates.OK, graph: GRAPH, persisted: false },
        ]);

        fireEvent.click(screen.getByText('a.json'));
        fireEvent.click(screen.getByRole('button', { name: /view/i }));

        await waitFor(() => {
            expect(getDefaultStore().get(mlirLoadedReportsAtom)).toEqual([{ name: 'a', data: GRAPH }]);
        });
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
        expect(recordReportLoadFailed).toHaveBeenCalledWith(ReportKind.MLIR, ReportLoadFailureReason.OTHER);
        expect(recordReportLoaded).not.toHaveBeenCalled();
        expect(getDefaultStore().get(mlirLoadedReportsAtom)).toEqual([]);
    });

    it('records one failure per selected report when split-view persistence fails', async () => {
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
            {
                filename: 'b.mlir',
                host: 'worker-01',
                name: 'b',
                status: ConnectionTestStates.OK,
                graph: GRAPH,
                persisted: true,
            },
        ]);

        fireEvent.click(screen.getByText('a.mlir'));
        fireEvent.click(screen.getByText('b.mlir'));
        fireEvent.click(screen.getByRole('button', { name: /view/i }));

        await waitFor(() => expect(recordReportLoadFailed).toHaveBeenCalledTimes(2));
        expect(recordReportLoaded).not.toHaveBeenCalled();
        expect(getDefaultStore().get(mlirLoadedReportsAtom)).toEqual([]);
    });

    it('retries conversion for a failed server file', async () => {
        const failedFile = new File(['module {}'], 'failed.mlir');
        getDefaultStore().set(mlirRetryFilesAtom, [failedFile]);
        getDefaultStore().set(mlirServersAtom, [SERVER]);
        getDefaultStore().set(selectedMlirServerAtom, SERVER);
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
                expect.objectContaining({
                    signal: expect.any(AbortSignal),
                    suppressProgressOverlay: true,
                }),
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
        getDefaultStore().set(mlirServersAtom, [SERVER]);
        getDefaultStore().set(selectedMlirServerAtom, SERVER);
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
                expect.objectContaining({
                    signal: expect.any(AbortSignal),
                    suppressProgressOverlay: true,
                }),
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

    it('retries using the first listed server when selection is still null', async () => {
        const failedFile = new File(['module {}'], 'failed.mlir');
        getDefaultStore().set(mlirRetryFilesAtom, [failedFile]);
        // Mirrors MLIRFileSelector: uploads use servers[0] when selected is unset.
        getDefaultStore().set(mlirServersAtom, [SERVER]);
        getDefaultStore().set(selectedMlirServerAtom, null);
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
                expect.objectContaining({
                    signal: expect.any(AbortSignal),
                    suppressProgressOverlay: true,
                }),
            );
        });
    });

    it('keeps other Retry buttons enabled while a retry is in flight', async () => {
        const fileA = new File(['module {}'], 'failed-a.mlir');
        const fileB = new File(['module {}'], 'failed-b.mlir');
        getDefaultStore().set(mlirRetryFilesAtom, [fileA, fileB]);
        getDefaultStore().set(mlirServersAtom, [SERVER]);
        getDefaultStore().set(selectedMlirServerAtom, SERVER);

        const retryDeferred: { resolve: ((value: unknown) => void) | null } = { resolve: null };

        uploadMlirFileToServer.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    retryDeferred.resolve = resolve;
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

        fireEvent.click(screen.getAllByRole('button', { name: /retry/i })[0]);

        await waitFor(() => {
            const retryButtons = screen.getAllByRole('button', { name: /retry/i });
            expect(retryButtons).toHaveLength(1);
            expect(retryButtons[0]).toBeEnabled();
        });

        retryDeferred.resolve?.({
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

        await waitFor(() => {
            const retryButtons = screen.getAllByRole('button', { name: /retry/i });
            expect(retryButtons).toHaveLength(2);
            expect(retryButtons[0]).toBeEnabled();
            expect(retryButtons[1]).toBeEnabled();
        });
    });
});

describe('MlirJsonFileLoader clearSplitPeers', () => {
    it('records invalid local JSON as a parse failure', async () => {
        const { container } = render(
            <MemoryRouter>
                <MlirJsonFileLoader />
            </MemoryRouter>,
        );
        const file = new File(['not json'], 'invalid.json', { type: 'application/json' });
        file.text = () => Promise.resolve('not json');

        fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
            target: { files: [file] },
        });

        await waitFor(() =>
            expect(recordReportLoadFailed).toHaveBeenCalledWith(ReportKind.MLIR, ReportLoadFailureReason.PARSE_ERROR),
        );
    });

    it('drops loaded split peers when a new local results batch starts', async () => {
        getDefaultStore().set(mlirLoadedReportsAtom, [
            { name: 'primary', data: GRAPH },
            { name: 'peer', data: GRAPH },
        ]);

        const { container } = render(
            <MemoryRouter>
                <MlirJsonFileLoader />
            </MemoryRouter>,
        );

        const file = new File([JSON.stringify(GRAPH)], 'next.json', { type: 'application/json' });
        // jsdom File blobs are not always readable via `.text()`; stub the
        // content so the local JSON path exercises clearSplitPeers.
        file.text = () => Promise.resolve(JSON.stringify(GRAPH));

        const fileInput = container.querySelector('input[type="file"]');
        fireEvent.change(fileInput as HTMLInputElement, {
            target: { files: [file] },
        });

        await waitFor(() => {
            expect(getDefaultStore().get(mlirLoadedReportsAtom)).toEqual([{ name: 'primary', data: GRAPH }]);
            expect(getDefaultStore().get(mlirFileResultsAtom)?.[0]?.name).toBe('next');
        });
    });

    it('drops loaded split peers when a server upload starts', async () => {
        getDefaultStore().set(mlirLoadedReportsAtom, [
            { name: 'primary', data: GRAPH },
            { name: 'peer', data: GRAPH },
        ]);
        uploadMlirFileToServer.mockResolvedValueOnce({
            data: {
                results: [
                    {
                        filename: 'model.mlir',
                        name: 'model',
                        status: ConnectionTestStates.OK,
                        graph: GRAPH,
                    },
                ],
            },
        });

        const { container } = render(
            <MemoryRouter>
                <MlirJsonFileLoader server={SERVER} />
            </MemoryRouter>,
        );

        const fileInput = container.querySelector('input[type="file"]');
        fireEvent.change(fileInput as HTMLInputElement, {
            target: { files: [new File(['module {}'], 'model.mlir')] },
        });

        await waitFor(() => {
            expect(getDefaultStore().get(mlirLoadedReportsAtom)).toEqual([{ name: 'primary', data: GRAPH }]);
        });
        await waitFor(() => {
            expect(getDefaultStore().get(mlirFileResultsAtom)?.[0]?.name).toBe('model');
        });
    });
});
