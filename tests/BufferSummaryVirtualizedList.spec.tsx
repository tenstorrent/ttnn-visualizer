// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferType } from '../src/model/BufferType';
import BufferSummaryVirtualizedList from '../src/components/buffer-summary/BufferSummaryVirtualizedList';
import { ScrollLocations } from '../src/definitions/VirtualLists';
import { BufferSummaryAxisConfiguration } from '../src/definitions/PlotConfigurations';

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

function renderVirtualizedList(isZoomedIn: boolean) {
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
        />,
    );
}

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
        expect(plotProps.memorySize).toBe(1024);
        expect(plotProps.plotZoomRange).toEqual([0, 1024]);

        const rowProps = bufferSummaryRowMock.mock.calls[0][0];
        expect(rowProps.memoryStart).toBe(0);
        expect(rowProps.memoryEnd).toBe(1024);
    });

    it('renders zoomed memory bounds and padded plot range', () => {
        renderVirtualizedList(true);

        const plotProps = memoryPlotRendererMock.mock.calls[0][0];
        expect(plotProps.memorySize).toBe(200);
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
});
