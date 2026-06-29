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
import { activeMlirDataAtom, activeMlirJsonAtom, mlirFileResultsAtom, mlirFileResultsOpenAtom } from '../src/store/app';
import { GraphBundle, MlirFileResult } from '../src/model/MLIRJsonModel';

const setActiveMlir = vi.fn();

vi.mock('../src/hooks/useMlirRemote', () => ({
    default: () => ({ setActiveMlir }),
}));

vi.mock('../src/functions/createToastNotification', () => ({
    default: vi.fn(),
    ToastType: { SUCCESS: 'success', ERROR: 'error' },
}));

const GRAPH: GraphBundle = { graphs: [{ id: 'g', nodes: [] }] };

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
            { filename: 'a.mlir', name: 'a', status: ConnectionTestStates.OK, graph: GRAPH, persisted: true },
        ]);

        expect(screen.getByRole('button', { name: /view/i })).toBeDisabled();

        fireEvent.click(screen.getByText('a.mlir'));

        expect(screen.getByRole('button', { name: /view/i })).toBeEnabled();
    });

    it('activates and persists the selected server file via View, then closes the overlay', async () => {
        renderOverlay([
            { filename: 'a.mlir', name: 'a', status: ConnectionTestStates.OK, graph: GRAPH, persisted: true },
        ]);

        fireEvent.click(screen.getByText('a.mlir'));
        fireEvent.click(screen.getByRole('button', { name: /view/i }));

        await waitFor(() => {
            expect(getDefaultStore().get(activeMlirDataAtom)).toEqual(GRAPH);
        });
        expect(getDefaultStore().get(activeMlirJsonAtom)).toBe('a');
        expect(setActiveMlir).toHaveBeenCalledWith('a');
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
        expect(screen.queryByText('MLIR upload results')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /view mlir uploads/i }));

        await waitFor(() => {
            expect(screen.getByText('MLIR upload results')).toBeInTheDocument();
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
});
