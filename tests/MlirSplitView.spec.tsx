// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GraphBundle } from '../src/model/MLIRJsonModel';
import MlirSplitView from '../src/components/mlir/MlirSplitView';

// The real MlGraph spins up a layout worker + React Flow; stub it to just echo
// the graph id it was handed so the test can assert per-pane wiring.
vi.mock('../src/components/mlir/MLIRViewReactFlow', () => ({
    default: ({ data }: { data: GraphBundle }) => <div data-testid='ml-graph'>{data.graphs[0]?.id}</div>,
}));

afterEach(cleanup);

const makeData = (ids: string[]): GraphBundle => ({ graphs: ids.map((id) => ({ id })) }) as unknown as GraphBundle;

const paneGraphIds = (): [string, string] => {
    const [left, right] = screen.getAllByTestId('ml-graph');
    return [left.textContent ?? '', right.textContent ?? ''];
};

describe('MlirSplitView', () => {
    it('opens both panes on the same (first) graph', () => {
        render(
            <MlirSplitView
                data={makeData(['g0', 'g1', 'g2'])}
                onExit={() => {}}
            />,
        );
        expect(paneGraphIds()).toEqual(['g0', 'g0']);
    });

    it('re-points a single pane without touching the other', () => {
        render(
            <MlirSplitView
                data={makeData(['g0', 'g1', 'g2'])}
                onExit={() => {}}
            />,
        );
        fireEvent.change(screen.getByLabelText('right pane graph'), { target: { value: '1' } });
        expect(paneGraphIds()).toEqual(['g0', 'g1']);
    });

    it('swaps the two panes', () => {
        render(
            <MlirSplitView
                data={makeData(['g0', 'g1', 'g2'])}
                onExit={() => {}}
            />,
        );
        fireEvent.change(screen.getByLabelText('right pane graph'), { target: { value: '2' } });
        // Each pane header carries its own swap button; either performs the swap.
        fireEvent.click(screen.getAllByRole('button', { name: 'Swap panes' })[0]);
        expect(paneGraphIds()).toEqual(['g2', 'g0']);
    });

    it('exits the split view from a pane close button', () => {
        const onExit = vi.fn();
        render(
            <MlirSplitView
                data={makeData(['g0', 'g1'])}
                onExit={onExit}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Close left pane' }));
        expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('renders a resizable divider between the panes', () => {
        render(
            <MlirSplitView
                data={makeData(['g0', 'g1'])}
                onExit={() => {}}
            />,
        );
        expect(screen.getByRole('separator', { name: 'Resize panes' })).toBeInTheDocument();
    });
});
