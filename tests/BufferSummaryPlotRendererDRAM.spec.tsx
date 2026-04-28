// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMemoryLayoutAtom, showBufferSummaryZoomedAtom } from '../src/store/app';
import { BufferType } from '../src/model/BufferType';
import { MEMORY_ZOOM_PADDING_RATIO } from '../src/definitions/BufferSummary';
import { DRAM_MEMORY_SIZE } from '../src/definitions/DRAMMemorySize';
import BufferSummaryPlotRendererDRAM from '../src/components/buffer-summary/BufferSummaryPlotRendererDRAM';
import { TestProviders } from './helpers/TestProviders';

const bufferSummaryVirtualizedListMock = vi.fn();

vi.mock('../src/components/buffer-summary/BufferSummaryVirtualizedList', () => ({
    default: (props: unknown) => {
        bufferSummaryVirtualizedListMock(props);
        return <div data-testid='buffer-summary-virtualized-list' />;
    },
}));

const baseTensorMap = new Map<number, Map<number, never>>();

const opA = {
    id: 1,
    name: 'op-a',
    buffers: [{ address: 100, size: 50, device_id: 0, buffer_type: BufferType.DRAM }],
};

const opB = {
    id: 2,
    name: 'op-b',
    buffers: [{ address: 7000, size: 100, device_id: 0, buffer_type: BufferType.DRAM }],
};

const opC = {
    id: 3,
    name: 'op-c',
    buffers: [{ address: 7300, size: 200, device_id: 0, buffer_type: BufferType.DRAM }],
};

function renderDRAMRenderer(uniqueBuffersByOperationList: (typeof opA)[]) {
    return render(
        <TestProviders
            initialAtomValues={[
                [showBufferSummaryZoomedAtom, true],
                [renderMemoryLayoutAtom, false],
            ]}
        >
            <BufferSummaryPlotRendererDRAM
                uniqueBuffersByOperationList={uniqueBuffersByOperationList}
                tensorListByOperation={baseTensorMap}
            />
        </TestProviders>,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(cleanup);

describe('BufferSummaryPlotRendererDRAM', () => {
    it('uses the first multi-operation segment for zoom bounds', () => {
        renderDRAMRenderer([opA, opB, opC]);

        const props = bufferSummaryVirtualizedListMock.mock.calls[0][0];
        expect(props.zoomStart).toBe(7000);
        expect(props.zoomEnd).toBe(7500);
        expect(props.memoryPadding).toBe((7500 - 7000) * MEMORY_ZOOM_PADDING_RATIO);
    });

    it('falls back to full DRAM range when no valid zoom segment exists', () => {
        renderDRAMRenderer([opA, opB]);

        const props = bufferSummaryVirtualizedListMock.mock.calls[0][0];
        expect(props.zoomStart).toBe(0);
        expect(props.zoomEnd).toBe(DRAM_MEMORY_SIZE);
        expect(props.memoryPadding).toBe(0);
    });

    it('passes through the original operation list when not zoomed in', () => {
        render(
            <TestProviders
                initialAtomValues={[
                    [showBufferSummaryZoomedAtom, false],
                    [renderMemoryLayoutAtom, true],
                ]}
            >
                <BufferSummaryPlotRendererDRAM
                    uniqueBuffersByOperationList={[opA, opB, opC]}
                    tensorListByOperation={baseTensorMap}
                />
            </TestProviders>,
        );

        const props = bufferSummaryVirtualizedListMock.mock.calls[0][0];
        expect(props.isZoomedIn).toBe(false);
        expect(props.operations).toEqual([opA, opB, opC]);
    });
});
