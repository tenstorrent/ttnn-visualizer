// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GraphBundle } from '../src/model/MLIRJsonModel';
import MlirSplitView from '../src/components/mlir/MlirSplitView';

// jsdom implements neither PointerEvent nor element pointer capture, so back
// PointerEvent with MouseEvent (carries clientX) and stub the capture calls;
// otherwise fireEvent.pointer* never reaches the divider drag handlers.
class FakePointerEvent extends MouseEvent {
    readonly pointerId: number;

    constructor(type: string, props: PointerEventInit = {}) {
        super(type, props);
        this.pointerId = props.pointerId ?? 0;
    }
}

beforeAll(() => {
    if (!('PointerEvent' in window)) {
        (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent =
            FakePointerEvent as unknown as typeof MouseEvent;
    }
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
});

const stubRect = (element: HTMLElement, width: number): void => {
    element.getBoundingClientRect = () =>
        ({ left: 0, width, top: 0, right: width, bottom: 600, height: 600, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
};

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

    it('re-points the right pane without touching the left', () => {
        render(
            <MlirSplitView
                data={makeData(['g0', 'g1', 'g2'])}
                onExit={() => {}}
            />,
        );
        fireEvent.change(screen.getByLabelText('right pane graph'), { target: { value: '1' } });
        expect(paneGraphIds()).toEqual(['g0', 'g1']);
    });

    it('re-points the left pane without touching the right', () => {
        render(
            <MlirSplitView
                data={makeData(['g0', 'g1', 'g2'])}
                onExit={() => {}}
            />,
        );
        fireEvent.change(screen.getByLabelText('left pane graph'), { target: { value: '2' } });
        expect(paneGraphIds()).toEqual(['g2', 'g0']);
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
        fireEvent.click(screen.getAllByRole('button', { name: 'Close split view' })[0]);
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

    it('resizes the left pane on divider drag, clamped to 20–80%', () => {
        const { container } = render(
            <MlirSplitView
                data={makeData(['g0', 'g1'])}
                onExit={() => {}}
            />,
        );
        stubRect(container.querySelector('.mlir-split-view') as HTMLElement, 1000);

        const divider = screen.getByRole('separator', { name: 'Resize panes' });
        const leftPane = screen.getByLabelText('left pane graph').closest('.mlir-split-pane') as HTMLElement;

        fireEvent.pointerDown(divider, { pointerId: 1 });

        fireEvent.pointerMove(divider, { pointerId: 1, clientX: 300 });
        expect(leftPane.style.flexBasis).toBe('30%');

        fireEvent.pointerMove(divider, { pointerId: 1, clientX: 50 });
        expect(leftPane.style.flexBasis).toBe('20%');

        fireEvent.pointerMove(divider, { pointerId: 1, clientX: 950 });
        expect(leftPane.style.flexBasis).toBe('80%');

        fireEvent.pointerUp(divider, { pointerId: 1 });
    });

    it('ignores pointer movement that is not part of an active drag', () => {
        const { container } = render(
            <MlirSplitView
                data={makeData(['g0', 'g1'])}
                onExit={() => {}}
            />,
        );
        stubRect(container.querySelector('.mlir-split-view') as HTMLElement, 1000);

        const divider = screen.getByRole('separator', { name: 'Resize panes' });
        const leftPane = screen.getByLabelText('left pane graph').closest('.mlir-split-pane') as HTMLElement;

        // No preceding pointerdown → the 50/50 split must stay put.
        fireEvent.pointerMove(divider, { pointerId: 1, clientX: 300 });
        expect(leftPane.style.flexBasis).toBe('50%');
    });
});
