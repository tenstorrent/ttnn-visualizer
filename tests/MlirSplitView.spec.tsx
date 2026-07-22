// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GraphBundle } from '../src/model/MLIRJsonModel';
import { TEST_IDS } from '../src/definitions/TestIds';
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

const originalPointerEvent = (window as { PointerEvent?: typeof MouseEvent }).PointerEvent;
const originalSetPointerCapture = Element.prototype.setPointerCapture;
const originalReleasePointerCapture = Element.prototype.releasePointerCapture;
const originalHasPointerCapture = Element.prototype.hasPointerCapture;

beforeAll(() => {
    if (!('PointerEvent' in window)) {
        (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent =
            FakePointerEvent as unknown as typeof MouseEvent;
    }
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => true);
});

// Restore the globals we monkey-patched so this suite can't leak pointer
// behaviour into unrelated tests sharing the jsdom environment.
afterAll(() => {
    if (originalPointerEvent) {
        (window as { PointerEvent?: typeof MouseEvent }).PointerEvent = originalPointerEvent;
    } else {
        delete (window as { PointerEvent?: typeof MouseEvent }).PointerEvent;
    }
    Element.prototype.setPointerCapture = originalSetPointerCapture;
    Element.prototype.releasePointerCapture = originalReleasePointerCapture;
    Element.prototype.hasPointerCapture = originalHasPointerCapture;
});

const stubRect = (element: HTMLElement, width: number): void => {
    element.getBoundingClientRect = () =>
        ({ left: 0, width, top: 0, right: width, bottom: 600, height: 600, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
};

// Hoisted so the vi.mock factory (itself hoisted above imports) can read it; a
// guard test below pins it to TEST_IDS.MLIR_GRAPH so the two can't drift.
const { MLIR_GRAPH_TEST_ID } = vi.hoisted(() => ({ MLIR_GRAPH_TEST_ID: 'mlir-graph' }));

// The real MlGraph spins up a layout worker + React Flow; stub it to just echo
// the graph id it was handed so the test can assert per-pane wiring.
vi.mock('../src/components/mlir/MLIRViewReactFlow', () => ({
    default: ({ data }: { data: GraphBundle }) => <div data-testid={MLIR_GRAPH_TEST_ID}>{data.graphs[0]?.id}</div>,
}));

afterEach(cleanup);

const makeData = (ids: string[]): GraphBundle => ({ graphs: ids.map((id) => ({ id })) }) as unknown as GraphBundle;

const renderInFileSplit = (ids: string[], onExit: () => void = () => {}) => {
    const data = makeData(ids);
    return render(
        <MlirSplitView
            leftData={data}
            rightData={data}
            onExit={onExit}
        />,
    );
};

const paneGraphIds = (): [string, string] => {
    const [left, right] = screen.getAllByTestId(TEST_IDS.MLIR_GRAPH);
    return [left.textContent ?? '', right.textContent ?? ''];
};

describe('MlirSplitView', () => {
    it('keeps the MlGraph stub test id in sync with the shared constant', () => {
        expect(MLIR_GRAPH_TEST_ID).toBe(TEST_IDS.MLIR_GRAPH);
    });

    it('opens both panes on the same (first) graph', () => {
        renderInFileSplit(['g0', 'g1', 'g2']);
        expect(paneGraphIds()).toEqual(['g0', 'g0']);
    });

    it('re-points the right pane without touching the left', () => {
        renderInFileSplit(['g0', 'g1', 'g2']);
        fireEvent.change(screen.getByLabelText('right pane graph'), { target: { value: '1' } });
        expect(paneGraphIds()).toEqual(['g0', 'g1']);
    });

    it('re-points the left pane without touching the right', () => {
        renderInFileSplit(['g0', 'g1', 'g2']);
        fireEvent.change(screen.getByLabelText('left pane graph'), { target: { value: '2' } });
        expect(paneGraphIds()).toEqual(['g2', 'g0']);
    });

    it('swaps the two panes', () => {
        renderInFileSplit(['g0', 'g1', 'g2']);
        fireEvent.change(screen.getByLabelText('right pane graph'), { target: { value: '2' } });
        // Each pane header carries its own swap button; either performs the swap.
        fireEvent.click(screen.getAllByRole('button', { name: 'Swap panes' })[0]);
        expect(paneGraphIds()).toEqual(['g2', 'g0']);
    });

    it('exits the split view from a pane close button', () => {
        const onExit = vi.fn();
        renderInFileSplit(['g0', 'g1'], onExit);
        fireEvent.click(screen.getAllByRole('button', { name: 'Close split view' })[0]);
        expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('renders a resizable divider between the panes', () => {
        renderInFileSplit(['g0', 'g1']);
        expect(screen.getByRole('separator', { name: 'Resize panes' })).toBeInTheDocument();
    });

    it('resizes the left pane on divider drag, clamped to 20–80%', () => {
        const { container } = renderInFileSplit(['g0', 'g1']);
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
        const { container } = renderInFileSplit(['g0', 'g1']);
        stubRect(container.querySelector('.mlir-split-view') as HTMLElement, 1000);

        const divider = screen.getByRole('separator', { name: 'Resize panes' });
        const leftPane = screen.getByLabelText('left pane graph').closest('.mlir-split-pane') as HTMLElement;

        // No preceding pointerdown → the 50/50 split must stay put.
        fireEvent.pointerMove(divider, { pointerId: 1, clientX: 300 });
        expect(leftPane.style.flexBasis).toBe('50%');
    });

    it('clamps stale pane indices when the graph list shrinks', () => {
        const data = makeData(['g0', 'g1', 'g2']);
        const { rerender } = render(
            <MlirSplitView
                leftData={data}
                rightData={data}
                onExit={() => {}}
            />,
        );
        fireEvent.change(screen.getByLabelText('right pane graph'), { target: { value: '2' } });
        expect(paneGraphIds()).toEqual(['g0', 'g2']);

        // A smaller re-upload while split view stays mounted must not feed an
        // out-of-range index (undefined graph) into either pane.
        const shrunk = makeData(['g0']);
        rerender(
            <MlirSplitView
                leftData={shrunk}
                rightData={shrunk}
                onExit={() => {}}
            />,
        );
        expect(paneGraphIds()).toEqual(['g0', 'g0']);
        expect((screen.getByLabelText('right pane graph') as HTMLSelectElement).value).toBe('0');
    });

    it('scopes each pane select to its own bundle and shows filename labels', () => {
        const left = makeData(['left-a', 'left-b']);
        const right = makeData(['right-only']);
        render(
            <MlirSplitView
                leftData={left}
                rightData={right}
                leftLabel='primary.mlir'
                rightLabel='compare.mlir'
                onExit={() => {}}
            />,
        );

        expect(screen.getByText('primary.mlir')).toBeInTheDocument();
        expect(screen.getByText('compare.mlir')).toBeInTheDocument();
        expect(paneGraphIds()).toEqual(['left-a', 'right-only']);

        fireEvent.change(screen.getByLabelText('left pane graph'), { target: { value: '1' } });
        expect(paneGraphIds()).toEqual(['left-b', 'right-only']);

        // Right pane has a single graph — changing left must not invent options on right.
        expect((screen.getByLabelText('right pane graph') as HTMLSelectElement).options).toHaveLength(1);
    });

    it('swaps dual-bundle panes without changing which props are primary', () => {
        const left = makeData(['L0', 'L1']);
        const right = makeData(['R0']);
        render(
            <MlirSplitView
                leftData={left}
                rightData={right}
                leftLabel='primary.mlir'
                rightLabel='compare.mlir'
                onExit={() => {}}
            />,
        );

        fireEvent.change(screen.getByLabelText('left pane graph'), { target: { value: '1' } });
        fireEvent.click(screen.getAllByRole('button', { name: 'Swap panes' })[0]);

        expect(paneGraphIds()).toEqual(['R0', 'L1']);
        // Labels move with the display swap.
        const leftHeader = screen.getByLabelText('left pane graph').closest('.mlir-split-pane-header');
        const rightHeader = screen.getByLabelText('right pane graph').closest('.mlir-split-pane-header');
        expect(leftHeader).toHaveTextContent('compare.mlir');
        expect(rightHeader).toHaveTextContent('primary.mlir');
    });
});
