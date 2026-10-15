// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { DeviceArchitecture } from '../src/definitions/DeviceArchitecture';
import { getChipDesign } from '../src/functions/getChipDesign';
import { parseSocDescriptorOverride } from '../src/functions/socDescriptorOverride';
import { ChipDesign } from '../src/model/ClusterModel';

// Every arch with a baked descriptor, so a new one is held to these rules without being listed.
const baked = Object.values(DeviceArchitecture).flatMap((arch) => {
    const design = getChipDesign(arch);
    return design ? [{ arch, design }] : [];
});

const NODE_LISTS = ['functional_workers', 'dram', 'eth', 'pcie', 'arc', 'router_only', 'dispatch'] as const;

const tilesOf = (design: ChipDesign): { list: string; tile: string }[] =>
    NODE_LISTS.flatMap((list) => {
        const value = (design[list] ?? []) as string[] | string[][];
        return value.flat().map((tile) => ({ list, tile }));
    });

describe('baked chip designs', () => {
    it('covers every arch the app bakes', () => {
        expect(baked.map(({ arch }) => arch).sort()).toEqual(
            [DeviceArchitecture.BLACKHOLE, DeviceArchitecture.QUASAR, DeviceArchitecture.WORMHOLE].sort(),
        );
    });

    // A tile outside the grid is never visited by the renderer, so it silently disappears.
    // tt-metal's Quasar descriptor shipped an 8x4 grid around workers at x 2..9 until June 2026.
    it.each(baked)('$arch: every tile lies inside the grid', ({ design }) => {
        const outside = tilesOf(design).filter(({ tile }) => {
            const [x, y] = tile.split('-').map(Number);
            return x >= design.grid.x_size || y >= design.grid.y_size;
        });

        expect(outside).toEqual([]);
    });

    // The renderer labels a tile from the first list that names it, so a duplicate hides one type.
    it.each(baked)('$arch: no tile is listed as two node types', ({ design }) => {
        const listByTile = new Map<string, string>();
        const duplicates = tilesOf(design).filter(({ list, tile }) => {
            const earlier = listByTile.get(tile);
            listByTile.set(tile, earlier ?? list);
            return earlier !== undefined;
        });

        expect(duplicates).toEqual([]);
    });

    it.each(baked)('$arch: passes the validator a report-supplied descriptor must pass', ({ design }) => {
        expect(parseSocDescriptorOverride(design).status).toBe('valid');
    });
});
