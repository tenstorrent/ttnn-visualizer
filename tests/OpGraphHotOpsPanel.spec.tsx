// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Provider, createStore } from 'jotai';

import OpGraphHotOpsPanel from '../src/components/operation-graph/OpGraphHotOpsPanel';
import { buildHotOpRows } from '../src/components/operation-graph/opGraphHotOps';
import { buildOpGraphPerfOverlay, getPerfColorForNs } from '../src/components/operation-graph/opGraphPerfOverlay';
import { HOT_OPS_SETTINGS_STORAGE_KEY } from '../src/definitions/HotOps';
import { NO_PERF_DATA_LABEL } from '../src/definitions/PerfOverlayStatus';
import { formatDuration } from '../src/functions/formatting';
import type { PerfOverlaySource } from '../src/functions/perfOverlay';

// Twelve linked ops, so the default top 10 has something to leave out; op N takes N µs.
const LINKED_IDS = Array.from({ length: 12 }, (_, index) => index + 1);
const PERF_ROWS: PerfOverlaySource[] = LINKED_IDS.map((id) => ({ id, device_time: id }));

interface RenderPanelOptions {
    graphOperationIds?: number[];
    selectedOperationId?: number | null;
    onSelectOperation?: (operationId: number) => void;
}

const renderPanel = ({
    graphOperationIds = LINKED_IDS,
    selectedOperationId = null,
    onSelectOperation = vi.fn(),
}: RenderPanelOptions = {}) => {
    const overlay = buildOpGraphPerfOverlay(PERF_ROWS, true, graphOperationIds);
    const names = new Map(graphOperationIds.map((id) => [id, `op_${id}`]));
    const rows = buildHotOpRows(overlay, graphOperationIds, names);
    const store = createStore();
    // The view owns the selection and the build, so a test hands the panel what it would.
    const state = { selected: selectedOperationId, isInert: false };
    const panel = () => (
        <Provider store={store}>
            <OpGraphHotOpsPanel
                rows={rows}
                linkedOpCount={overlay.linkedOpCount}
                totalNs={overlay.totalNs}
                minNs={overlay.minNs}
                maxNs={overlay.maxNs}
                selectedOperationId={state.selected}
                onSelectOperation={onSelectOperation}
                isInert={state.isInert}
            />
        </Provider>
    );
    const { rerender } = render(panel());
    return {
        overlay,
        select: (operationId: number | null) => {
            state.selected = operationId;
            rerender(panel());
        },
        setInert: (isInert: boolean) => {
            state.isInert = isInert;
            rerender(panel());
        },
    };
};

const listedIds = () =>
    Array.from(document.querySelectorAll('.op-graph-hot-ops-id'), (cell) => Number(cell.textContent));

const rowFor = (operationId: number) => screen.getByTitle(`${operationId} op_${operationId}`);

const choose = (label: string) => fireEvent.click(screen.getByText(label));

afterEach(() => {
    cleanup();
    sessionStorage.clear();
});

describe('OpGraphHotOpsPanel rows', () => {
    it('lists the slowest ten by default', () => {
        renderPanel();

        expect(listedIds()).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
        expect(screen.getByRole('heading', { name: 'Slowest operations' })).toBeInTheDocument();
    });

    it('gives each op its rank, name, duration and share of the total', () => {
        renderPanel();

        // 12 µs of the 78 µs the twelve ops add up to.
        const row = within(rowFor(12));
        expect(row.getByText('1')).toHaveClass('op-graph-hot-ops-rank');
        expect(row.getByText('op_12')).toBeInTheDocument();
        expect(row.getByText(formatDuration(12_000))).toBeInTheDocument();
        expect(row.getByText('15.4%')).toBeInTheDocument();
    });

    it('colours each swatch where its duration sits on the legend', () => {
        const { overlay } = renderPanel();

        const swatch = rowFor(9).querySelector<HTMLElement>('.op-graph-hot-ops-swatch')!;
        const probe = document.createElement('div');
        probe.style.backgroundColor = getPerfColorForNs(9_000, overlay.minNs, overlay.maxNs);
        expect(swatch.style.backgroundColor).toBe(probe.style.backgroundColor);
    });

    it('selects the op a row names', () => {
        const onSelectOperation = vi.fn();
        renderPanel({ onSelectOperation });

        fireEvent.click(rowFor(10));

        expect(onSelectOperation).toHaveBeenCalledWith(10);
    });

    it('marks the selected op', () => {
        renderPanel({ selectedOperationId: 11 });

        expect(rowFor(11)).toHaveAttribute('aria-current', 'true');
        expect(rowFor(12)).not.toHaveAttribute('aria-current');
    });

    // The details open below the list and shorten it, which can hide the row just clicked. #2087
    describe('when the selection shortens the list', () => {
        const box = (top: number, bottom: number) => ({ top, bottom }) as DOMRect;

        // The list now ends 200 px down, and the given op's row sits 50 px past that.
        const shortenUnder = (operationId: number) => {
            const list = document.querySelector<HTMLElement>('.op-graph-hot-ops-list')!;
            vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(box(0, 200));
            vi.spyOn(rowFor(operationId), 'getBoundingClientRect').mockReturnValue(box(230, 250));
            return list;
        };

        // Enter or Space on a focused button arrives as a click with no pointer detail.
        it.each([
            ['clicked', 1],
            ['activated from the keyboard', 0],
        ])('scrolls the row just %s back into view, and no further', (_, detail) => {
            const { select } = renderPanel();
            const list = shortenUnder(5);

            fireEvent.click(rowFor(5), { detail });
            select(5);

            expect(list.scrollTop).toBe(50);
        });

        it('leaves the list alone for a selection made on the graph', () => {
            const { select } = renderPanel();
            const list = shortenUnder(5);

            select(5);

            expect(list.scrollTop).toBe(0);
        });

        it('leaves the list alone when the selection settles on a row other than the one clicked', () => {
            const { select } = renderPanel();
            const list = shortenUnder(5);
            vi.spyOn(rowFor(7), 'getBoundingClientRect').mockReturnValue(box(260, 280));

            fireEvent.click(rowFor(5));
            select(7);

            expect(list.scrollTop).toBe(0);
        });

        it('leaves the list alone when the row clicked is still in view', () => {
            const { select } = renderPanel();
            const list = shortenUnder(5);
            list.scrollTop = 40;
            vi.spyOn(rowFor(5), 'getBoundingClientRect').mockReturnValue(box(100, 120));

            fireEvent.click(rowFor(5));
            select(5);

            expect(list.scrollTop).toBe(40);
        });
    });

    // The graph rebuilding: the list stays, scroll and all, but nothing in it may act. #2088
    it('goes inert while the graph rebuilds, on the same list', () => {
        const { setInert } = renderPanel();
        const section = screen.getByRole('region', { name: 'Slowest operations' });
        const list = within(section).getByRole('list');
        expect(section).not.toHaveAttribute('inert');
        list.scrollTop = 40;

        setInert(true);
        expect(section).toHaveAttribute('inert');
        expect(within(section).getByRole('list')).toBe(list);

        setInert(false);
        expect(section).not.toHaveAttribute('inert');
        expect(within(section).getByRole('list')).toBe(list);
        expect(list.scrollTop).toBe(40);
    });
});

describe('OpGraphHotOpsPanel controls', () => {
    it('names each control group and marks its current choice', () => {
        renderPanel();

        const rowsToShow = screen.getByRole('radiogroup', { name: 'Rows to show' });
        const sortOrder = screen.getByRole('radiogroup', { name: 'Sort order' });
        expect(within(rowsToShow).getByRole('radio', { name: 'Top 10' })).toHaveAttribute('aria-checked', 'true');
        expect(within(sortOrder).getByRole('radio', { name: 'Slowest first' })).toHaveAttribute('aria-checked', 'true');

        choose('By ID');

        expect(within(sortOrder).getByRole('radio', { name: 'By ID' })).toHaveAttribute('aria-checked', 'true');
    });

    it('shows every linked op under All', () => {
        renderPanel();

        choose('All');

        expect(listedIds()).toHaveLength(12);
    });

    it('orders the kept ops by id', () => {
        renderPanel();

        choose('Top 25');
        choose('By ID');

        expect(listedIds()).toEqual(LINKED_IDS);
    });

    it('offers to show ops without perf data only when the graph has some', () => {
        renderPanel();

        expect(screen.queryByLabelText('Hide ops without perf data')).not.toBeInTheDocument();
    });

    it('lists ops without perf data last once they are no longer hidden', () => {
        renderPanel({ graphOperationIds: [...LINKED_IDS, 40, 30] });
        choose('All');

        fireEvent.click(screen.getByLabelText('Hide ops without perf data'));

        expect(listedIds().slice(-2)).toEqual([30, 40]);
        expect(within(rowFor(40)).getByText(NO_PERF_DATA_LABEL)).toBeInTheDocument();
        expect(rowFor(40).querySelector<HTMLElement>('.op-graph-hot-ops-swatch')?.style.backgroundColor).toBe('');
    });

    it('opens with the settings the session left', () => {
        sessionStorage.setItem(
            HOT_OPS_SETTINGS_STORAGE_KEY,
            JSON.stringify({ limit: 25, sort: 'operationId', hideUnlinked: true }),
        );

        renderPanel();

        expect(listedIds()).toEqual(LINKED_IDS);
    });

    it('opens on the defaults when the stored settings are unreadable', () => {
        sessionStorage.setItem(HOT_OPS_SETTINGS_STORAGE_KEY, 'null');

        renderPanel();

        expect(listedIds()).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    });

    it('offers to mark the listed ops on the graph, off until asked (#2085)', () => {
        renderPanel();
        const mark = screen.getByRole('checkbox', { name: 'Mark on graph' });
        expect(mark).not.toBeChecked();

        fireEvent.click(mark);

        expect(mark).toBeChecked();
        expect(JSON.parse(sessionStorage.getItem(HOT_OPS_SETTINGS_STORAGE_KEY) ?? '{}')).toMatchObject({
            markOnGraph: true,
        });
    });

    it('turns marking back off, and keeps that for the session', () => {
        renderPanel();
        const mark = screen.getByRole('checkbox', { name: 'Mark on graph' });

        fireEvent.click(mark);
        fireEvent.click(mark);

        expect(mark).not.toBeChecked();
        expect(JSON.parse(sessionStorage.getItem(HOT_OPS_SETTINGS_STORAGE_KEY) ?? '{}')).toMatchObject({
            markOnGraph: false,
        });
    });

    it('keeps its settings for the browser session', () => {
        renderPanel();

        choose('Top 100');
        choose('By ID');

        expect(JSON.parse(sessionStorage.getItem(HOT_OPS_SETTINGS_STORAGE_KEY) ?? '{}')).toMatchObject({
            limit: 100,
            sort: 'operationId',
        });
    });
});
