// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * A tensor without an address arrives with the buffer type its memory config
 * declares, and a host tensor, which declares none, with `null` rather than the
 * DRAM tt-metal stores for it. These pin what the list does with `null`: no tag,
 * no buffer details, and a filter option of its own rather than a place under
 * any buffer type.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TensorList from '../src/components/TensorList';
import { Tensor } from '../src/model/APIData';
import { BufferType } from '../src/model/BufferType';
import { tensorBufferTypeFiltersAtom } from '../src/store/app';
import { useGetTensorDeallocationReportByOperation, useOperationsList, useTensors } from '../src/hooks/useAPI';
import { TestProviders } from './helpers/TestProviders';

vi.mock('../src/hooks/useAPI', () => ({
    useOperationsList: vi.fn(),
    useTensors: vi.fn(),
    useGetTensorDeallocationReportByOperation: vi.fn(),
}));

vi.mock('../src/hooks/useRestoreScrollPosition', () => ({
    default: () => ({ getListState: () => undefined, updateListState: vi.fn() }),
}));

vi.mock('../src/hooks/useScrollShade', () => ({
    default: () => ({
        hasScrolledFromTop: false,
        hasScrolledToBottom: false,
        updateScrollShade: vi.fn(),
        resetScrollShade: vi.fn(),
        shadeClasses: { top: 'top-shade', bottom: 'bottom-shade' },
    }),
}));

// jsdom lays nothing out, so the real virtualiser renders no rows; this one
// renders every row it is asked for.
vi.mock('@tanstack/react-virtual', () => ({
    useVirtualizer: ({ count }: { count: number }) => ({
        getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: 0 })),
        getTotalSize: () => count * 39,
        scrollOffset: 0,
        measurementsCache: [],
        measureElement: () => {},
        scrollToIndex: vi.fn(),
    }),
}));

const tensor = (id: number, shape: string, bufferType: BufferType | null, address: number | null): Tensor =>
    ({
        id,
        shape,
        dtype: 'DataType.BFLOAT16',
        layout: 'Layout.TILE',
        address,
        buffer_type: bufferType,
        device_id: 0,
        memory_config: null,
        producers: [],
        consumers: [],
        producerNames: [],
        consumerNames: [],
        size: null,
    }) as unknown as Tensor;

const DRAM_TENSOR = tensor(1, 'Shape([1, 111])', BufferType.DRAM, 100);
const UNADDRESSED_L1_TENSOR = tensor(2, 'Shape([1, 222])', BufferType.L1, null);
const HOST_TENSOR = tensor(3, 'Shape([1, 333])', null, null);

const renderList = (bufferTypeFilters: (BufferType | null)[] = []) =>
    render(
        <TestProviders initialAtomValues={[[tensorBufferTypeFiltersAtom, bufferTypeFilters]]}>
            <TensorList />
        </TestProviders>,
    );

const rowFor = (container: HTMLElement, shapeText: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('li.list-item-container')).find((row) =>
        row.textContent?.includes(shapeText),
    );

const memoryTagIn = (row: HTMLElement | undefined) => row?.querySelector('.memory-tag')?.textContent ?? null;

beforeEach(() => {
    vi.mocked(useOperationsList).mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<
        typeof useOperationsList
    >);
    vi.mocked(useTensors).mockReturnValue({
        data: [DRAM_TENSOR, UNADDRESSED_L1_TENSOR, HOST_TENSOR],
        error: null,
        isLoading: false,
    } as unknown as ReturnType<typeof useTensors>);
    vi.mocked(useGetTensorDeallocationReportByOperation).mockReturnValue({
        nonDeallocatedTensorList: new Map(),
    } as unknown as ReturnType<typeof useGetTensorDeallocationReportByOperation>);
});

// RTL auto-cleanup is off in this project.
afterEach(cleanup);

describe('TensorList', () => {
    it('tags each tensor with its buffer type, and a host tensor with none', () => {
        const { container } = renderList();

        expect(memoryTagIn(rowFor(container, '111'))).toBe('DRAM');
        expect(memoryTagIn(rowFor(container, '222'))).toBe('L1');

        const hostRow = rowFor(container, '333');
        expect(hostRow).toBeDefined();
        expect(memoryTagIn(hostRow)).toBeNull();
    });

    it('offers buffer details for a tensor with a buffer type, not for a host tensor', () => {
        const { container } = renderList();

        expect(rowFor(container, '111')?.textContent).toContain('Buffer details');
        expect(rowFor(container, '333')?.textContent).not.toContain('Buffer details');
    });

    it('leaves a host tensor out of the DRAM filter', () => {
        const { container } = renderList([BufferType.DRAM]);

        expect(rowFor(container, '111')).toBeDefined();
        expect(rowFor(container, '222')).toBeUndefined();
        expect(rowFor(container, '333')).toBeUndefined();
    });

    it('lists only the tensors with no buffer type under that filter', () => {
        const { container } = renderList([null]);

        expect(rowFor(container, '111')).toBeUndefined();
        expect(rowFor(container, '222')).toBeUndefined();
        expect(rowFor(container, '333')).toBeDefined();
    });

    it('combines the no-buffer-type filter with a buffer type', () => {
        const { container } = renderList([BufferType.DRAM, null]);

        expect(rowFor(container, '111')).toBeDefined();
        expect(rowFor(container, '222')).toBeUndefined();
        expect(rowFor(container, '333')).toBeDefined();
    });

    it('lists an unaddressed tensor under the buffer type its memory config declares', () => {
        const { container } = renderList([BufferType.L1]);

        expect(rowFor(container, '111')).toBeUndefined();
        expect(rowFor(container, '222')).toBeDefined();
        expect(rowFor(container, '333')).toBeUndefined();
    });
});
