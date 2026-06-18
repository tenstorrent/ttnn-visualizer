// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TensorVisualisationComponent from '../src/components/tensor-sharding-visualization/TensorVisualisationComponent';
import { BufferChunk, Tensor } from '../src/model/APIData';
import { BufferType } from '../src/model/BufferType';
import { TestProviders } from './helpers/TestProviders';

const mockUseBufferChunks = vi.fn();
const mockUseDevices = vi.fn();
vi.mock('../src/hooks/useAPI.tsx', () => ({
    useBufferChunks: () => mockUseBufferChunks(),
    useDevices: () => mockUseDevices(),
}));

const DEVICE_2X2 = {
    num_x_cores: 2,
    num_y_cores: 2,
    worker_l1_size: 1_000_000,
};

function makeChunk(overrides: Partial<BufferChunk> = {}): BufferChunk {
    return {
        operation_id: 1,
        device_id: 0,
        address: 0x1000,
        bank_id: 0,
        core_x: 0,
        core_y: 0,
        chunk_address: 0x1000,
        chunk_size: 256,
        page_size: 32,
        num_pages: 8,
        buffer_type: BufferType.L1,
        rank: 0,
        id: '1_0_4096_0_0_0_1_0',
        ...overrides,
    };
}

function tensor(id: number): Tensor {
    return {
        id,
        operation_id: 1,
        device_id: 0,
        address: 0x1000,
        shape: '[1, 1]',
        dtype: 'f32',
        layout: 'TILE',
        memory_config: null,
        producers: [],
        consumers: [],
        comparison: null,
    } as unknown as Tensor;
}

beforeEach(() => {
    mockUseDevices.mockReturnValue({ data: [DEVICE_2X2] });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('TensorVisualisationComponent - no mutation of cached BufferChunks', () => {
    it('does not assign tensor_id / color onto cached chunks (tensorByAddress path)', () => {
        // Stable reference simulates the React Query cache handing the same
        // array back on every consumer call. The objects inside are what we
        // care about — none of them should grow new fields after render.
        const cached: BufferChunk[] = [
            makeChunk({ address: 0x1000, bank_id: 0, core_x: 0, core_y: 0 }),
            makeChunk({ address: 0x2000, bank_id: 1, core_x: 1, core_y: 0, id: '1_0_8192_1_1_0_1_0' }),
        ];
        const snapshot = structuredClone(cached);
        mockUseBufferChunks.mockReturnValue({ data: cached });

        const tensorByAddress = new Map<number, Tensor>([[0x1000, tensor(42)]]);

        render(
            <TestProviders>
                <TensorVisualisationComponent
                    title='unit test'
                    operationId={1}
                    isOpen
                    onClose={() => {}}
                    tensorByAddress={tensorByAddress}
                    plotZoomRange={[0, 0x3000]}
                />
            </TestProviders>,
        );

        // No keys added in place; deep equality against the pre-render snapshot.
        expect(cached).toEqual(snapshot);
        for (const chunk of cached) {
            expect(chunk).not.toHaveProperty('tensor_id');
            expect(chunk).not.toHaveProperty('color');
        }
    });

    it('does not mutate cached chunks across a re-render with new props', () => {
        const cached: BufferChunk[] = [makeChunk({ address: 0x1000, bank_id: 0 })];
        const snapshot = structuredClone(cached);
        mockUseBufferChunks.mockReturnValue({ data: cached });

        const { rerender } = render(
            <TestProviders>
                <TensorVisualisationComponent
                    title='first pass'
                    operationId={1}
                    isOpen
                    onClose={() => {}}
                    tensorId={7}
                    plotZoomRange={[0, 0x2000]}
                />
            </TestProviders>,
        );

        // Swap the tensor association to a different prop shape: a path
        // through `tensorByAddress` instead of the plain `tensorId`. Both
        // branches used to mutate; neither should now.
        rerender(
            <TestProviders>
                <TensorVisualisationComponent
                    title='second pass'
                    operationId={1}
                    isOpen
                    onClose={() => {}}
                    tensorByAddress={new Map([[0x1000, tensor(99)]])}
                    plotZoomRange={[0, 0x2000]}
                />
            </TestProviders>,
        );

        expect(cached).toEqual(snapshot);
        for (const chunk of cached) {
            expect(chunk).not.toHaveProperty('tensor_id');
            expect(chunk).not.toHaveProperty('color');
        }
    });

    it('falls through to the buffer palette when no tensor association applies', () => {
        // Sanity that the no-tensor branch still produces a render rather
        // than crashing on undefined colour — covers the `?? 'red'` floor
        // we added to DecoratedBufferChunk.color.
        const cached: BufferChunk[] = [makeChunk({ address: 0x1000, bank_id: 0 })];
        mockUseBufferChunks.mockReturnValue({ data: cached });

        const { container } = render(
            <TestProviders>
                <TensorVisualisationComponent
                    title='unit test'
                    operationId={1}
                    isOpen
                    onClose={() => {}}
                    plotZoomRange={[0, 0x2000]}
                />
            </TestProviders>,
        );

        // SVGBufferRenderer always emits a fill on every rect; if the
        // projection forgot to provide one, the rect would render with
        // fill=""/undefined.
        const rect = container.ownerDocument.querySelector('rect');
        expect(rect).not.toBeNull();
        expect(rect!.getAttribute('fill')).toBeTruthy();
    });
});
