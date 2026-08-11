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
import { RankedAnnotation, TopNAnnotationMode } from '../src/definitions/TopNAnnotations';
import { LATE_DEALLOC_RAIL_LABEL, LateDeallocationRunStart } from '../src/definitions/LateDeallocation';
import { RAIL_MAX_DOTS } from '../src/definitions/NavigationRail';
import { BuffersByOperation } from '../src/model/APIData';
import { TensorDeallocationReport } from '../src/model/BufferSummary';
import { TEST_IDS } from '../src/definitions/TestIds';
import { buildLateDeallocationRunStart, buildTensorDeallocationReport } from './helpers/lateDeallocationFixtures';

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

const plotControlsMock = vi.fn();

vi.mock('../src/components/buffer-summary/BufferSummaryPlotControls', () => ({
    default: (props: unknown) => {
        plotControlsMock(props);
        return <div data-testid='buffer-summary-controls' />;
    },
}));

vi.mock('@blueprintjs/core', async () => {
    const original = await vi.importActual('@blueprintjs/core');
    return {
        ...original,
        // Mirrors Blueprint in the one respect the stylesheet depends on: the
        // child is wrapped in an element, and `className` lands on that wrapper
        // rather than the child. Dropping the class here would hide layout bugs
        // in the tick's flex children, which are these wrappers.
        Tooltip: ({ children, className }: { children: React.ReactNode; className?: string }) => (
            <div className={className}>{children}</div>
        ),
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
    extraProps: {
        // Spread last, so anything here overrides the shared defaults.
        operations?: BuffersByOperation[];
        topNAnnotationsByOpId?: Map<number, RankedAnnotation>;
        topNAnnotationMode?: TopNAnnotationMode;
        lateDeallocationRunStarts?: readonly LateDeallocationRunStart[];
        lateDeallocationRunCount?: number;
        getTensorDeallocationReport?: (operationId: number) => TensorDeallocationReport[];
    } = {},
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

const buildTensorReport = (overrides: Partial<TensorDeallocationReport> = {}): TensorDeallocationReport =>
    buildTensorDeallocationReport({ id: 7, lastOperationId: 1, lastConsumerOperationId: 0, ...overrides });

const buildRunStart = (overrides: Partial<LateDeallocationRunStart>): LateDeallocationRunStart =>
    buildLateDeallocationRunStart({
        tensors: [buildTensorReport({ lastOperationId: overrides.opId ?? 1 })],
        ...overrides,
    });

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

            expect(screen.queryByTestId(TEST_IDS.TOP_N_RAIL)).toBeNull();
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

            const badge = screen.getByTestId(`${TEST_IDS.TOP_N_BADGE}-1`);
            expect(badge).toHaveTextContent('#3');
            expect(badge).toHaveAttribute('data-rank', '3');
        });

        // The tick's flex children are Blueprint's tooltip target spans, not the
        // link and badge themselves. The stylesheet lets the label span shrink so
        // long op names ellipsise, and pins the badge span — which only works
        // while the two spans are distinguishable. When one rule covered both,
        // a long op name shrank the badge until it was clipped.
        it('gives the op-label and badge tooltip wrappers distinct classes', () => {
            const annotations = new Map<number, RankedAnnotation>([
                [1, buildAnnotation({ opId: 1, rowIndex: 0, rank: 3 })],
            ]);
            const { container } = renderVirtualizedList(false, { topNAnnotationsByOpId: annotations });

            const tick = container.querySelector('.y-axis-tick');
            const label = tick?.querySelector(':scope > .y-axis-tick-label');
            const badgeWrapper = tick?.querySelector(':scope > .y-axis-tick-badge');

            expect(label).not.toBeNull();
            expect(badgeWrapper).not.toBeNull();
            expect(label).not.toBe(badgeWrapper);
            expect(badgeWrapper?.querySelector('.top-n-badge')).not.toBeNull();
        });

        it('renders one rail dot per annotation, sorted by rank ascending', () => {
            const annotations = new Map<number, RankedAnnotation>([
                [1, buildAnnotation({ opId: 1, rowIndex: 0, rank: 2 })],
                [2, buildAnnotation({ opId: 2, rowIndex: 1, rank: 1 })],
            ]);
            renderVirtualizedList(false, { topNAnnotationsByOpId: annotations });

            const rail = screen.getByTestId(TEST_IDS.TOP_N_RAIL);
            const dots = rail.querySelectorAll('.top-n-rail-dot');
            expect(dots).toHaveLength(2);
            // Both dots should be addressable by their op id for downstream wiring.
            expect(screen.getByTestId(`${TEST_IDS.TOP_N_RAIL_DOT}-1`)).toBeInTheDocument();
            expect(screen.getByTestId(`${TEST_IDS.TOP_N_RAIL_DOT}-2`)).toBeInTheDocument();
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
            expect(rail).toHaveAttribute('data-testid', TEST_IDS.TOP_N_RAIL);
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
            const dot = screen.getByTestId(`${TEST_IDS.TOP_N_RAIL_DOT}-2`) as HTMLButtonElement;
            const item = dot.closest('li');
            expect(item?.style.top).toBe('50%');
        });

        // The rank's position on the perf scale is the dot's only quantitative
        // reading, and it travels through `NavigationRail`'s optional `dotStyle`
        // prop — a boundary that can be dropped on either side without any
        // class- or text-based assertion noticing.
        it('colours each rail dot from the perf scale', () => {
            const annotations = new Map<number, RankedAnnotation>([
                [1, buildAnnotation({ opId: 1, rowIndex: 0, rank: 1, t: 1 })],
                [2, buildAnnotation({ opId: 2, rowIndex: 1, rank: 2, t: 0 })],
            ]);
            renderVirtualizedList(false, { topNAnnotationsByOpId: annotations });

            const slowest = screen.getByTestId(`${TEST_IDS.TOP_N_RAIL_DOT}-1`);
            const fastest = screen.getByTestId(`${TEST_IDS.TOP_N_RAIL_DOT}-2`);
            const slowestColor = slowest.style.getPropertyValue('--top-n-color');

            expect(slowestColor).not.toBe('');
            expect(fastest.style.getPropertyValue('--top-n-color')).not.toBe(slowestColor);
        });

        it('shows the rank number inside each rail dot so the colour scale is legible', () => {
            const annotations = new Map<number, RankedAnnotation>([
                [1, buildAnnotation({ opId: 1, rowIndex: 0, rank: 2 })],
                [2, buildAnnotation({ opId: 2, rowIndex: 1, rank: 1 })],
            ]);
            renderVirtualizedList(false, { topNAnnotationsByOpId: annotations });

            expect(screen.getByTestId(`${TEST_IDS.TOP_N_RAIL_DOT}-1`)).toHaveTextContent('2');
            expect(screen.getByTestId(`${TEST_IDS.TOP_N_RAIL_DOT}-2`)).toHaveTextContent('1');
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

            fireEvent.click(screen.getByTestId(`${TEST_IDS.TOP_N_RAIL_DOT}-2`));
            expect(scrollToIndexMock).toHaveBeenCalledWith(1, { align: 'center' });
        });
    });

    // Geometry, hit-target size and `pointer-events: auto` all hang off the
    // shared `.rail-dot` class, while every other assertion here queries the
    // per-rail modifier — so losing it would leave both rails rendering dots
    // that are unstyled and too small to click, with the suite still green.
    describe('shared rail dot geometry', () => {
        it('gives every dot the shared class alongside its own modifier', () => {
            const annotations = new Map<number, RankedAnnotation>([
                [1, buildAnnotation({ opId: 1, rowIndex: 0, rank: 1 })],
            ]);
            renderVirtualizedList(false, {
                topNAnnotationsByOpId: annotations,
                lateDeallocationRunStarts: [buildRunStart({ opId: 1, rowIndex: 0 })],
            });

            expect(screen.getByTestId(`${TEST_IDS.TOP_N_RAIL_DOT}-1`)).toHaveClass('rail-dot', 'top-n-rail-dot');
            expect(screen.getByTestId(`${TEST_IDS.LATE_DEALLOC_RAIL_DOT}-1`)).toHaveClass(
                'rail-dot',
                'late-dealloc-rail-dot',
            );
        });
    });

    describe('rail gutter', () => {
        const getRailColumns = (container: HTMLElement) =>
            container.querySelector<HTMLElement>('.buffer-summary-chart')?.style.getPropertyValue('--rail-columns');

        it('reserves no gutter when neither rail has data', () => {
            const { container } = renderVirtualizedList(false);

            expect(getRailColumns(container)).toBe('0');
        });

        it('reserves one column for a single rail', () => {
            const { container } = renderVirtualizedList(false, {
                lateDeallocationRunStarts: [buildRunStart({ opId: 1, rowIndex: 0 })],
            });

            expect(getRailColumns(container)).toBe('1');
        });

        it('reserves a column per rail when both are showing', () => {
            const annotations = new Map<number, RankedAnnotation>([
                [1, buildAnnotation({ opId: 1, rowIndex: 0, rank: 1 })],
            ]);
            const { container } = renderVirtualizedList(false, {
                topNAnnotationsByOpId: annotations,
                lateDeallocationRunStarts: [buildRunStart({ opId: 1, rowIndex: 0 })],
            });

            expect(getRailColumns(container)).toBe('2');
        });

        // Rails are hidden when there are no rows to point at, so the gutter
        // they would have claimed has to go with them.
        it('reserves no gutter when there are no rows, even with rail data', () => {
            const annotations = new Map<number, RankedAnnotation>([
                [1, buildAnnotation({ opId: 1, rowIndex: 0, rank: 1 })],
            ]);
            const { container } = renderVirtualizedList(false, {
                operations: [],
                topNAnnotationsByOpId: annotations,
                lateDeallocationRunStarts: [buildRunStart({ opId: 1, rowIndex: 0 })],
            });

            expect(getRailColumns(container)).toBe('0');
            expect(screen.queryByTestId(TEST_IDS.TOP_N_RAIL)).toBeNull();
            expect(screen.queryByTestId(TEST_IDS.LATE_DEALLOC_RAIL)).toBeNull();
        });
    });

    describe('late deallocation rail (#963)', () => {
        it('forwards the run count to the controls so the toggle can advertise it', () => {
            renderVirtualizedList(false, { lateDeallocationRunCount: 4 });

            expect(plotControlsMock).toHaveBeenCalledWith(expect.objectContaining({ lateDeallocationRunCount: 4 }));
        });

        // The badge is a bare glyph, so every tensor it stands for has to be named
        // in its accessible name — that text is the only way to tell one stale
        // tensor from several without opening the row.
        it('badges a row holding stale tensors, naming them', () => {
            // Virtualizer mock only emits row 0 — give it the report for op 1.
            renderVirtualizedList(false, {
                getTensorDeallocationReport: () => [buildTensorReport({ id: 7 }), buildTensorReport({ id: 9 })],
            });

            const badge = screen.getByTestId(`${TEST_IDS.LATE_DEALLOC_BADGE}-1`);
            expect(badge.getAttribute('aria-label')).toMatch(/Opportunity to deallocate earlier: tensors 7, 9/i);
        });

        it('badges no row when nothing is late-deallocated', () => {
            const { container } = renderVirtualizedList(false);

            expect(container.querySelector('.late-dealloc-badge')).toBeNull();
        });

        // The badge follows the hatching, which the row draws from the same
        // report: a hatched row with an empty gutter reads as a marker that went
        // missing rather than as one finding continuing.
        it('badges a row that keeps holding a tensor, even though the rail plots only run starts', () => {
            renderVirtualizedList(false, {
                // Row 0 (op 1) holds a tensor whose run opened earlier, so it is
                // absent from the run starts the rail is given.
                getTensorDeallocationReport: () => [buildTensorReport({ id: 7 })],
                lateDeallocationRunStarts: [buildRunStart({ opId: 2, rowIndex: 1 })],
            });

            expect(screen.getByTestId(`${TEST_IDS.LATE_DEALLOC_BADGE}-1`)).toBeInTheDocument();
        });

        it('gives the row the same report the badge was built from', () => {
            const report = [buildTensorReport({ id: 7 })];
            renderVirtualizedList(false, { getTensorDeallocationReport: () => report });

            expect(bufferSummaryRowMock).toHaveBeenCalledWith(
                expect.objectContaining({ tensorDeallocationReport: report }),
            );
        });

        it('orders the badges to match the rails, late deallocation before top-N', () => {
            const annotations = new Map<number, RankedAnnotation>([
                [1, buildAnnotation({ opId: 1, rowIndex: 0, rank: 1 })],
            ]);
            const { container } = renderVirtualizedList(false, {
                topNAnnotationsByOpId: annotations,
                getTensorDeallocationReport: () => [buildTensorReport({ id: 7 })],
            });

            const badges = container.querySelectorAll('.y-axis-tick .late-dealloc-badge, .y-axis-tick .top-n-badge');
            expect([...badges].map((badge) => badge.className)).toEqual(['late-dealloc-badge', 'top-n-badge']);
        });

        it('renders no rail when nothing is late-deallocated', () => {
            renderVirtualizedList(false);

            expect(screen.queryByTestId(TEST_IDS.LATE_DEALLOC_RAIL)).toBeNull();
        });

        it('renders one dot per run start in a labelled list', () => {
            renderVirtualizedList(false, {
                lateDeallocationRunStarts: [
                    buildRunStart({ opId: 1, rowIndex: 0 }),
                    buildRunStart({ opId: 2, rowIndex: 1 }),
                ],
            });

            const rail = screen.getByRole('list', { name: LATE_DEALLOC_RAIL_LABEL });
            expect(rail).toHaveAttribute('data-testid', TEST_IDS.LATE_DEALLOC_RAIL);
            expect(within(rail).getAllByRole('listitem')).toHaveLength(2);
        });

        it('sits in its own gutter column so it cannot overlap the top-N rail', () => {
            const annotations = new Map<number, RankedAnnotation>([
                [1, buildAnnotation({ opId: 1, rowIndex: 0, rank: 1 })],
            ]);
            const { container } = renderVirtualizedList(false, {
                topNAnnotationsByOpId: annotations,
                lateDeallocationRunStarts: [buildRunStart({ opId: 1, rowIndex: 0 })],
            });

            // Flow order in the track decides the column, so the late-dealloc
            // rail must precede top-N to leave it the outermost strip.
            const rails = container.querySelectorAll('.rail-track > ul');
            expect([...rails].map((rail) => rail.getAttribute('data-testid'))).toEqual([
                TEST_IDS.LATE_DEALLOC_RAIL,
                TEST_IDS.TOP_N_RAIL,
            ]);
        });

        it('positions rail dots by rowIndex / operations.length', () => {
            renderVirtualizedList(false, { lateDeallocationRunStarts: [buildRunStart({ opId: 2, rowIndex: 1 })] });

            const dot = screen.getByTestId(`${TEST_IDS.LATE_DEALLOC_RAIL_DOT}-2`);
            expect(dot.closest('li')?.style.top).toBe('50%');
        });

        it('names the tensor and its last use on each dot for screen readers', () => {
            renderVirtualizedList(false, { lateDeallocationRunStarts: [buildRunStart({ opId: 1, rowIndex: 0 })] });

            const dot = screen.getByTestId(`${TEST_IDS.LATE_DEALLOC_RAIL_DOT}-1`);
            expect(dot.getAttribute('aria-label')).toMatch(/Opportunity to deallocate earlier: tensor 7/i);
            expect(dot.getAttribute('aria-label')).toMatch(/last used by 0 ttnn\.add/i);
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
            renderVirtualizedList(false, { lateDeallocationRunStarts: [buildRunStart({ opId: 2, rowIndex: 1 })] });

            fireEvent.click(screen.getByTestId(`${TEST_IDS.LATE_DEALLOC_RAIL_DOT}-2`));
            expect(scrollToIndexMock).toHaveBeenCalledWith(1, { align: 'center' });
        });

        // Coalescing only engages past `RAIL_MAX_DOTS` rows, so the arguments the
        // list hands it are unreachable from every other case here — all of which
        // have two rows — even though the merging itself is unit-tested.
        it('caps the dots when a report has more run starts than the rail can show', () => {
            const rowCount = RAIL_MAX_DOTS * 2;
            const manyOperations = Array.from({ length: rowCount }, (_unused, index) => ({
                id: index + 1,
                name: `op-${index + 1}`,
                buffers: [{ address: 100, size: 16, device_id: 0, buffer_type: BufferType.L1 }],
            }));
            const runStarts = manyOperations.map((operation, rowIndex) =>
                buildRunStart({
                    opId: operation.id,
                    rowIndex,
                    tensors: [buildTensorReport({ id: operation.id })],
                }),
            );

            renderVirtualizedList(false, { operations: manyOperations, lateDeallocationRunStarts: runStarts });

            const dots = screen.getByTestId(TEST_IDS.LATE_DEALLOC_RAIL).querySelectorAll('.late-dealloc-rail-dot');

            expect(runStarts).toHaveLength(rowCount);
            expect(dots).toHaveLength(RAIL_MAX_DOTS);
            // A surviving dot still speaks for the run starts it swallowed.
            expect(dots[0].getAttribute('aria-label')).toMatch(/tensors 1, 2/);
        });
    });
});
