// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { GraphBundle } from '../src/model/MLIRJsonModel';
import { activeMlirDataAtom } from '../src/store/app';

// Route wiring only: stub the heavy leaves (graph view, split view, loaders) so
// the test can assert the Split-view toggle mounts/unmounts the right subtree.
const { mockUseMlir } = vi.hoisted(() => ({ mockUseMlir: vi.fn() }));

vi.mock('react-helmet-async', () => ({ Helmet: () => null }));
vi.mock('../src/functions/getServerConfig', () => ({ default: () => null }));
vi.mock('../src/hooks/useAPI', () => ({ useMlir: () => mockUseMlir() }));
vi.mock('../src/components/mlir/MlirJsonFileLoader', () => ({ default: () => null }));
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

const renderRoute = (data: GraphBundle | null) => {
    const store = createStore();
    if (data) {
        store.set(activeMlirDataAtom, data);
    }
    return render(
        <Provider store={store}>
            <MLIR />
        </Provider>,
    );
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

    it('hides the split-view toggle while a report is loading', () => {
        mockUseMlir.mockReturnValue({ data: null, isLoading: true, error: undefined });
        renderRoute(null);

        expect(screen.getByTestId('mlir-processing')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Split view' })).not.toBeInTheDocument();
    });
});
