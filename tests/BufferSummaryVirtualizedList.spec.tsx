// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferType } from '../src/model/BufferType';
import BufferSummaryVirtualizedList from '../src/components/buffer-summary/BufferSummaryVirtualizedList';
import { ScrollLocations } from '../src/definitions/VirtualLists';
import { BufferSummaryAxisConfiguration } from '../src/definitions/PlotConfigurations';
import { RankedAnnotation, TopNAnnotationMode } from '../src/functions/topNAnnotations';

const memoryPlotRendererMock = vi.fn();
const bufferSummaryRowMock = vi.fn();
const virtualizerFactoryMock = vi.fn();
const restoreScrollPositionHookMock = vi.fn();
const scrollShadeHookMock = vi.fn();
const bufferNavigationHookMock = vi.fn();

vi.mock('@tanstack/react-virtual', () => ({
    useVirtualizer: (options: unknown) => virtualizerFactoryMock(options),
}));

vi.mock('../src/hooks/useRestoreScrollPosition', () => ({
    default: (...args: unknown[]) => restoreScrollPositionHookMock(...args),
}));

vi.mock('../src/hooks/useScrollShade', () => ({
    default: () => scrollShadeHookMock(),
}));

vi.mock('../src/hooks/useBufferNavigation', () => ({
    default: (...args: unknown[]) => bufferNavigationHookMock(...args),
}));

vi.mock('../src/components/operation-details/MemoryPlotRenderer', () => ({
    default: (props: unknown) => {
        memoryPlotRendererMock(props);
        return <div data-testid='memory-plot-renderer' />;
    },
}));

vi.mock('../src/components/buffer-summary/BufferSummaryRow', () => ({
    default: (props: unknown) => {
        bufferSummaryRowMock(props);
        return <div data-testid='buffer-summary-row' />;
    },
}));

vi.mock('../src/components/buffer-summary/BufferSummaryPlotControls', () => ({
    default: () => <div data-testid='buffer-summary-controls' />,
}));

vi.mock('@blueprintjs/core', async () => {
    const original = await vi.importActual('@blueprintjs/core');
    return {
        ...original,
        Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    };
});

const updateListStateMock = vi.fn();
const updateScrollShadeMock = vi.fn();

const operations = [
    {
        id: 1,
        name: 'op-1',
        buffers: [{ address: 100, size: 16, device_id: 0, buffer_type: BufferType.L1 }],
    },
    {
        id: 2,
        name: 'op-2',
        buffers: [{ address: 200, size: 32, device_id: 0, buffer_type: BufferType.L1 }],
    },
];

const tensorListByOperation = new Map<number, Map<number, never>>();

function renderVirtualizedList(
    isZoomedIn: boolean,
    extraProps: { topNAnnotationsByOpId?: Map<number, RankedAnnotation>; topNAnnotationMode?: TopNAnnotationMode } = {},
) {
    return render(
        <BufferSummaryVirtualizedList
            operations={operations}
            tensorListByOperation={tensorListByOperation}
            isZoomedIn={isZoomedIn}
            showMemoryLayout={false}
            scrollLocation={ScrollLocations.BUFFER_SUMMARY}
            memorySize={1024}
            zoomStart={100}
            zoomEnd={200}
            memoryPadding={10}
            axisConfiguration={BufferSummaryAxisConfiguration}
            getOperationTooltipContent={(operation) => operation.name}
            renderOperationLink={(operation) => <span>{operation.name}</span>}
            {...extraProps}
        />,
    );
}

const buildAnnotation = (overrides: Partial<RankedAnnotation>): RankedAnnotation => ({
    opId: overrides.opId ?? 1,
    rowIndex: overrides.rowIndex ?? 0,
    rank: overrides.rank ?? 1,
    t: overrides.t ?? 1,
    valueLabel: overrides.valueLabel ?? '1.50 ms',
    rawValue: overrides.rawValue ?? 1_500_000,
});

beforeEach(() => {
    vi.clearAllMocks();

    restoreScrollPositionHookMock.mockReturnValue({
        getListState: () => ({ scrollOffset: 24, measurementsCache: [{ index: 0 }] }),
        updateListState: updateListStateMock,
    });

    scrollShadeHookMock.mockReturnValue({
        hasScrolledFromTop: false,
        hasScrolledToBottom: false,
        updateScrollShade: updateScrollShadeMock,
        shadeClasses: { top: 'top-shade', bottom: 'bottom-shade' },
    });

    virtualizerFactoryMock.mockReturnValue({
        getVirtualItems: () => [{ index: 0, key: 'row-0', start: 0 }],
        getTotalSize: () => 140,
        scrollOffset: 42,
        measurementsCache: [{ index: 0, start: 0, end: 70, size: 70 }],
    });
});

afterEach(cleanup);

describe('BufferSummaryVirtualizedList', () => {
    it('renders non-zoomed memory bounds to plot and rows', () => {
        renderVirtualizedList(false);

        const plotProps = memoryPlotRendererMock.mock.calls[0][0];
        expect(plotProps.memoryZoomEnd).toBe(1024);
        expect(plotProps.plotZoomRange).toEqual([0, 1024]);

        const rowProps = bufferSummaryRowMock.mock.calls[0][0];
        expect(rowProps.memoryStart).toBe(0);
        expect(rowProps.memoryEnd).toBe(1024);
    });

    it('renders zoomed memory bounds and padded plot range', () => {
        renderVirtualizedList(true);

        const plotProps = memoryPlotRendererMock.mock.calls[0][0];
        expect(plotProps.memoryZoomEnd).toBe(200);
        expect(plotProps.plotZoomRange).toEqual([90, 210]);

        const rowProps = bufferSummaryRowMock.mock.calls[0][0];
        expect(rowProps.memoryStart).toBe(100);
        expect(rowProps.memoryEnd).toBe(200);
    });

    it('persists virtual list state on unmount', async () => {
        const { unmount } = renderVirtualizedList(false);
        unmount();

        await waitFor(() => {
            expect(updateListStateMock).toHaveBeenCalledWith({
                scrollOffset: 42,
                measurementsCache: [{ index: 0, start: 0, end: 70, size: 70 }],
            });
        });
    });

    it('applies bottom shade when virtualized rows are partial', () => {
        const { container } = renderVirtualizedList(false);
        const scrollableElement = container.querySelector('.scrollable-element');

        expect(scrollableElement).toHaveClass('bottom-shade');
    });

    describe('top-N annotations (#1517)', () => {
        it('does not render the rail or any rank badges when annotations are empty', () => {
            const { container } = renderVirtualizedList(false);

            expect(container.querySelector('[data-testid="top-n-rail"]')).toBeNull();
            expect(container.querySelector('.top-n-badge')).toBeNull();
        });

        it('renders a rank badge in the y-tick gutter for an annotated row', () => {
            // Virtualizer mock only emits row 0 — give it the annotation for op 1.
            const annotations = new Map<number, RankedAnnotation>([
                [1, buildAnnotation({ opId: 1, rowIndex: 0, rank: 3, valueLabel: '850 µs' })],
            ]);
            renderVirtualizedList(false, {
                topNAnnotationsByOpId: annotations,
                topNAnnotationMode: TopNAnnotationMode.PERF_TIME,
            });

            const badge = screen.getByTestId('top-n-badge-1');
            expect(badge).toHaveTextContent('#3');
            expect(badge).toHaveAttribute('data-rank', '3');
        });

        it('renders one rail dot per annotation, sorted by rank ascending', () => {
            const annotations = new Map<number, RankedAnnotation>([
                [1, buildAnnotation({ opId: 1, rowIndex: 0, rank: 2 })],
                [2, buildAnnotation({ opId: 2, rowIndex: 1, rank: 1 })],
            ]);
            renderVirtualizedList(false, { topNAnnotationsByOpId: annotations });

            const rail = screen.getByTestId('top-n-rail');
            const dots = rail.querySelectorAll('.top-n-rail-dot');
            expect(dots).toHaveLength(2);
            // Both dots should be addressable by their op id for downstream wiring.
            expect(screen.getByTestId('top-n-rail-dot-1')).toBeInTheDocument();
            expect(screen.getByTestId('top-n-rail-dot-2')).toBeInTheDocument();
        });

        it('uses semantic <ul>/<li> markup so screen readers announce the rail as a list with item count', () => {
            const annotations = new Map<number, RankedAnnotation>([
                [1, buildAnnotation({ opId: 1, rowIndex: 0, rank: 2 })],
                [2, buildAnnotation({ opId: 2, rowIndex: 1, rank: 1 })],
            ]);
            renderVirtualizedList(false, { topNAnnotationsByOpId: annotations });

            // The rail is the `<ul>` element; querying by ARIA role surfaces
            // the implicit role=list/listitem semantics we care about for
            // screen-reader output.
            const rail = screen.getByRole('list', { name: 'Top-ranked operations' });
            expect(rail.tagName).toBe('UL');
            expect(rail).toHaveAttribute('data-testid', 'top-n-rail');
            // One `<li>` per annotation; each contains the dot button.
            const items = within(rail).getAllByRole('listitem');
            expect(items).toHaveLength(2);
            expect(items.every((item) => item.tagName === 'LI')).toBe(true);
            expect(items[0].querySelector('button.top-n-rail-dot')).not.toBeNull();
            expect(items[1].querySelector('button.top-n-rail-dot')).not.toBeNull();
        });

        it('positions rail dots by rowIndex / operations.length', () => {
            const annotations = new Map<number, RankedAnnotation>([
                [2, buildAnnotation({ opId: 2, rowIndex: 1, rank: 1 })],
            ]);
            renderVirtualizedList(false, { topNAnnotationsByOpId: annotations });

            // Row 1 of 2 → 50% down the rail. `top` lives on the `<li>` so
            // the Tooltip wrapper span inside has real geometry (otherwise
            // Blueprint anchors the popover at the rail origin).
            const dot = screen.getByTestId('top-n-rail-dot-2') as HTMLButtonElement;
            const item = dot.closest('li');
            expect(item?.style.top).toBe('50%');
        });

        it('shows the rank number inside each rail dot so the colour scale is legible', () => {
            const annotations = new Map<number, RankedAnnotation>([
                [1, buildAnnotation({ opId: 1, rowIndex: 0, rank: 2 })],
                [2, buildAnnotation({ opId: 2, rowIndex: 1, rank: 1 })],
            ]);
            renderVirtualizedList(false, { topNAnnotationsByOpId: annotations });

            expect(screen.getByTestId('top-n-rail-dot-1')).toHaveTextContent('2');
            expect(screen.getByTestId('top-n-rail-dot-2')).toHaveTextContent('1');
        });

        it('scrolls the virtualizer to the row when a rail dot is clicked', () => {
            const scrollToIndexMock = vi.fn();
            virtualizerFactoryMock.mockReturnValue({
                getVirtualItems: () => [{ index: 0, key: 'row-0', start: 0 }],
                getTotalSize: () => 140,
                scrollOffset: 0,
                measurementsCache: [],
                scrollToIndex: scrollToIndexMock,
            });
            const annotations = new Map<number, RankedAnnotation>([
                [2, buildAnnotation({ opId: 2, rowIndex: 1, rank: 1 })],
            ]);
            renderVirtualizedList(false, { topNAnnotationsByOpId: annotations });

            fireEvent.click(screen.getByTestId('top-n-rail-dot-2'));
            expect(scrollToIndexMock).toHaveBeenCalledWith(1, { align: 'center' });
        });
    });
});
