// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Isolated module graph: mock MAX_DRAM_BUFFERS_FOR_GAP_SPLIT without affecting
 * BufferSummaryPlotRendererDRAM.spec.tsx (Vitest hoists vi.mock per file).
 */

import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMemoryLayoutAtom, showBufferSummaryZoomedAtom } from '../src/store/app';
import { BufferType } from '../src/model/BufferType';
import { MEMORY_ZOOM_PADDING_RATIO } from '../src/definitions/BufferSummary';
import BufferSummaryPlotRendererDRAM from '../src/components/buffer-summary/BufferSummaryPlotRendererDRAM';
import { TestProviders } from './helpers/TestProviders';

vi.mock('../src/definitions/BufferSummary', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/definitions/BufferSummary')>();
    return {
        ...actual,
        MAX_DRAM_BUFFERS_FOR_GAP_SPLIT: 2,
    };
});

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

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
});

describe('BufferSummaryPlotRendererDRAM (over MAX_DRAM_BUFFERS_FOR_GAP_SPLIT)', () => {
    it('skips gap splitting and keeps the full operation list for zoom', () => {
        render(
            <TestProviders
                initialAtomValues={[
                    [showBufferSummaryZoomedAtom, true],
                    [renderMemoryLayoutAtom, false],
                ]}
            >
                <BufferSummaryPlotRendererDRAM
                    uniqueBuffersByOperationList={[opA, opB, opC]}
                    tensorListByOperation={baseTensorMap}
                />
            </TestProviders>,
        );

        const props = bufferSummaryVirtualizedListMock.mock.calls[0][0] as {
            operations: unknown;
            isZoomedIn: boolean;
            zoomStart: number;
            zoomEnd: number;
            memoryPadding: number;
        };

        expect(props.operations).toEqual([opA, opB, opC]);
        expect(props.isZoomedIn).toBe(true);
        expect(props.zoomStart).toBe(100);
        expect(props.zoomEnd).toBe(7500);
        expect(props.memoryPadding).toBe((7500 - 100) * MEMORY_ZOOM_PADDING_RATIO);
        // eslint-disable-next-line no-console
        expect(console.warn).toHaveBeenCalled();
    });
});
