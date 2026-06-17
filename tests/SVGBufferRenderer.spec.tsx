// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import SVGBufferRenderer from '../src/components/tensor-sharding-visualization/SVGBufferRenderer';
import { DecoratedBufferChunk } from '../src/model/APIData';
import { BufferType } from '../src/model/BufferType';

function chunk(overrides: Partial<DecoratedBufferChunk> = {}): DecoratedBufferChunk {
    const merged = {
        operation_id: 1,
        device_id: 0,
        address: 1000,
        bank_id: 1,
        core_x: 0,
        core_y: 0,
        chunk_address: 1000,
        chunk_size: 256,
        page_size: 32,
        num_pages: 8,
        buffer_type: BufferType.L1,
        rank: 0,
        color: '#ff0000',
        ...overrides,
    };
    // Derive id from the grouping tuple so chunks that differ on any
    // collision-relevant field also get distinct React keys.
    return {
        ...merged,
        id: `${merged.operation_id}_${merged.device_id}_${merged.address}_${merged.bank_id}_${merged.core_x}_${merged.core_y}_${merged.buffer_type}_${merged.rank}`,
    };
}

afterEach(cleanup);

describe('SVGBufferRenderer (pre-aggregated chunks)', () => {
    it('renders one rect per BufferChunk', () => {
        const { container } = render(
            <SVGBufferRenderer
                height={20}
                memoryStart={0}
                memoryEnd={4096}
                data={[
                    chunk({ address: 100, chunk_size: 512 }),
                    chunk({ address: 1024, chunk_size: 256 }),
                    chunk({ address: 2000, chunk_size: 128 }),
                ]}
            />,
        );

        expect(container.querySelectorAll('rect')).toHaveLength(3);
    });

    it('positions and sizes rects by (address - memoryStart) / memoryRange and chunk_size / memoryRange', () => {
        const { container } = render(
            <SVGBufferRenderer
                height={20}
                memoryStart={1000}
                memoryEnd={5000}
                data={[chunk({ address: 2000, chunk_size: 1000, color: '#00ff00' })]}
            />,
        );

        const rect = container.querySelector('rect');
        expect(rect).not.toBeNull();
        // (2000 - 1000) / (5000 - 1000) = 0.25 → "25%"
        expect(rect!.getAttribute('x')).toBe('25%');
        // 1000 / 4000 = 0.25 → "25%"
        expect(rect!.getAttribute('width')).toBe('25%');
        expect(rect!.getAttribute('fill')).toBe('#00ff00');
    });

    it('renders an empty group when there are no chunks', () => {
        const { container } = render(
            <SVGBufferRenderer
                height={10}
                memoryStart={0}
                memoryEnd={1024}
                data={[]}
            />,
        );

        expect(container.querySelectorAll('rect')).toHaveLength(0);
    });
});
