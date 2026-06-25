// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import getChartData from '../src/functions/getChartData';
import { Chunk, Tensor } from '../src/model/APIData';

const noTensor = (): Tensor | null => null;

const makeTensor = (id: number, address: number): Tensor =>
    ({
        id,
        address,
        buffer_type: null,
        producers: [],
        consumers: [],
        producerNames: [],
        consumerNames: [],
        shape: '[1, 1, 32, 32]',
        dtype: 'BFLOAT16',
        layout: 'TILE',
        memory_config: null,
        device_id: 0,
    }) as unknown as Tensor;

describe('getChartData outline mode (#1652)', () => {
    const chunk: Chunk = { address: 0x4000, size: 1024 };

    it('emits a filled bar by default', () => {
        const [bar] = getChartData([chunk], noTensor);

        expect(bar.marker?.color).toBeDefined();
        expect(bar.marker?.line?.width).toBe(0);
    });

    it('emits a half-opacity tinted fill with a solid-colour border when outline is set', () => {
        const tensorLookup = (address: number) => (address === chunk.address ? makeTensor(7, address) : null);
        const [bar] = getChartData([chunk], tensorLookup, { outline: true });

        expect(bar.marker?.line?.width).toBeGreaterThan(0);
        expect(bar.marker?.line?.color).toBeDefined();
        expect(bar.marker?.line?.color).not.toMatch(/rgba\(/);
        expect(bar.marker?.color).toMatch(/^rgba\(\d+,\d+,\d+,0\.5\)$/);
    });

    it('prepends the "Globally allocated CB" header to the hover when outline is set', () => {
        const tensorLookup = (address: number) => (address === chunk.address ? makeTensor(7, address) : null);

        const [aliased] = getChartData([chunk], tensorLookup, { outline: true });
        const [anonymous] = getChartData([chunk], tensorLookup);

        expect(aliased.hovertemplate).toMatch(/Globally allocated CB/);
        expect(aliased.hovertemplate).toMatch(/aliased to Tensor 7/);
        expect(anonymous.hovertemplate).not.toMatch(/Globally allocated/);
    });

    it('emits a minimal aliased header when no tensor sits at the address', () => {
        const [aliased] = getChartData([chunk], noTensor, { outline: true });

        expect(aliased.hovertemplate).toMatch(/Globally allocated CB/);
        expect(aliased.hovertemplate).not.toMatch(/aliased to/);
    });
});
