// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { GraphBundle } from '../src/model/MLIRJsonModel';
import { mlirLoadedReportsAtom, mlirSplitViewEpochAtom } from '../src/store/app';

// Route wiring only: stub the heavy leaves (graph view, split view, loader) so
// the test can assert the split-view and loader-collapse toggles mount/unmount
// the right subtree.
const { mockUseMlir } = vi.hoisted(() => ({ mockUseMlir: vi.fn() }));

vi.mock('react-helmet-async', () => ({ Helmet: () => null }));
vi.mock('../src/functions/getServerConfig', () => ({ default: () => null }));
vi.mock('../src/hooks/useAPI', () => ({ useMlir: () => mockUseMlir() }));
vi.mock('../src/components/mlir/MlirJsonFileLoader', () => ({
    default: () => <div data-testid='mlir-file-loader' />,
}));
vi.mock('../src/components/MlirProcessingStatus', () => ({ default: () => <div data-testid='mlir-processing' /> }));
vi.mock('../src/components/mlir/MLIRViewReactFlow', () => ({ default: () => <div data-testid='mlir-single-graph' /> }));
vi.mock('../src/components/mlir/MlirSplitView', () => ({
    default: ({ onExit }: { onExit: () => void }) => (
        <div data-testid='mlir-split-view'>
            <button
                type='button'
                onClick={onExit}
            >
                close split
            </button>
        </div>
    ),
}));

// eslint-disable-next-line import/first
import MLIR from '../src/routes/MLIR';

const sampleData = { graphs: [{ id: 'g0', nodes: [] }] } as unknown as GraphBundle;
const peerData = { graphs: [{ id: 'g1', nodes: [] }] } as unknown as GraphBundle;

const renderRoute = (data: GraphBundle | null, peer: GraphBundle | null = null) => {
    const store = createStore();
    if (data) {
        const reports = [{ name: 'primary', data }];
        if (peer) {
            reports.push({ name: 'compare', data: peer });
        }
        store.set(mlirLoadedReportsAtom, reports);
    }
    return {
        store,
        ...render(
            <Provider store={store}>
                <MLIR />
            </Provider>,
        ),
    };
};

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('MLIR route split-view wiring', () => {
    it('toggles into split view and back to the single graph + toolbar', () => {
        mockUseMlir.mockReturnValue({ data: null, isLoading: false, error: undefined });
        renderRoute(sampleData);

        expect(screen.getByTestId('mlir-single-graph')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Split view' }));
        expect(screen.getByTestId('mlir-split-view')).toBeInTheDocument();
        expect(screen.queryByTestId('mlir-single-graph')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Split view' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'close split' }));
        expect(screen.getByTestId('mlir-single-graph')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Split view' })).toBeInTheDocument();
    });

    it('opens split when a peer report is present and keeps it on close', () => {
        mockUseMlir.mockReturnValue({ data: null, isLoading: false, error: undefined });
        const { store } = renderRoute(sampleData, peerData);

        expect(screen.getByTestId('mlir-split-view')).toBeInTheDocument();
        expect(screen.queryByTestId('mlir-single-graph')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Split view' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'close split' }));
        // Closing only hides split — peer stays so toolbar split can offer both reports.
        expect(store.get(mlirLoadedReportsAtom)).toEqual([
            { name: 'primary', data: sampleData },
            { name: 'compare', data: peerData },
        ]);
        expect(screen.getByTestId('mlir-single-graph')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Split view' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Split view' }));
        expect(screen.getByTestId('mlir-split-view')).toBeInTheDocument();
    });

    it('re-opens auto-split after dismiss when a new two-file View bumps the epoch', () => {
        mockUseMlir.mockReturnValue({ data: null, isLoading: false, error: undefined });
        const { store } = renderRoute(sampleData, peerData);

        fireEvent.click(screen.getByRole('button', { name: 'close split' }));
        expect(screen.getByTestId('mlir-single-graph')).toBeInTheDocument();

        // Same peer names as before — without bumping the epoch, dismiss would stick.
        act(() => {
            store.set(mlirSplitViewEpochAtom, store.get(mlirSplitViewEpochAtom) + 1);
        });
        expect(screen.getByTestId('mlir-split-view')).toBeInTheDocument();
    });

    it('hides the split-view toggle while a report is loading', () => {
        mockUseMlir.mockReturnValue({ data: null, isLoading: true, error: undefined });
        renderRoute(null);

        expect(screen.getByTestId('mlir-processing')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Split view' })).not.toBeInTheDocument();
    });
});

describe('MLIR route loader collapse', () => {
    it('keeps the loader open with no toggle on the initial (no-graph) screen', () => {
        mockUseMlir.mockReturnValue({ data: null, isLoading: false, error: undefined });
        renderRoute(null);

        expect(screen.getByTestId('mlir-file-loader')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Load / switch file' })).not.toBeInTheDocument();
    });

    it('collapses the loader once a graph is present and toggles it back on demand', () => {
        mockUseMlir.mockReturnValue({ data: null, isLoading: false, error: undefined });
        renderRoute(sampleData);

        expect(screen.queryByTestId('mlir-file-loader')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Load / switch file' }));
        expect(screen.getByTestId('mlir-file-loader')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Load / switch file' }));
        expect(screen.queryByTestId('mlir-file-loader')).not.toBeInTheDocument();
    });

    it('re-collapses a manually revealed loader when the active graph changes', () => {
        mockUseMlir.mockReturnValue({ data: null, isLoading: false, error: undefined });
        const { store } = renderRoute(sampleData);

        fireEvent.click(screen.getByRole('button', { name: 'Load / switch file' }));
        expect(screen.getByTestId('mlir-file-loader')).toBeInTheDocument();

        act(() => {
            store.set(mlirLoadedReportsAtom, [
                {
                    name: 'primary',
                    data: { graphs: [{ id: 'g1', nodes: [] }] } as unknown as GraphBundle,
                },
            ]);
        });

        expect(screen.queryByTestId('mlir-file-loader')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Load / switch file' })).toBeInTheDocument();
    });
});
