// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { DeviceArchitecture } from '../src/definitions/DeviceArchitecture';
import { getAllBakedChipDesigns, getChipDesign } from '../src/functions/getChipDesign';
import { resolveMaxCores } from '../src/functions/getCoreCount';
import { formatGridSize } from '../src/functions/formatting';
import { parseSocDescriptorOverride } from '../src/functions/socDescriptorOverride';
import { ChipDesign } from '../src/model/ClusterModel';

// Every baked descriptor, so a new one is held to these rules without being listed.
const baked = getAllBakedChipDesigns().map(({ arch, design }) => ({
    arch,
    design,
    name: `${arch} ${formatGridSize(design.grid)}`,
}));

const NODE_LISTS = ['functional_workers', 'dram', 'eth', 'pcie', 'arc', 'router_only', 'dispatch'] as const;

const tilesOf = (design: ChipDesign): { list: string; tile: string }[] =>
    NODE_LISTS.flatMap((list) => {
        const value = (design[list] ?? []) as string[] | string[][];
        return value.flat().map((tile) => ({ list, tile }));
    });

describe('baked chip designs', () => {
    it('covers every descriptor the app bakes', () => {
        expect(baked.map(({ name }) => name).sort()).toEqual(
            ['blackhole 17x12', 'grendel 12x8', 'quasar 11x8', 'quasar 12x19', 'wormhole_b0 10x12'].sort(),
        );
    });

    // Two parts sharing an arch name and a grid could never be told apart. Apart from the list
    // above, which whoever bakes the next part edits, and could edit to match a duplicate.
    it('bakes each arch on distinct grids', () => {
        expect(new Set(baked.map(({ name }) => name)).size).toBe(baked.length);
    });

    // A tile outside the grid is never visited by the renderer, so it silently disappears.
    // tt-metal's Quasar descriptor shipped an 8x4 grid around workers at x 2..9 until June 2026.
    it.each(baked)('$name: every tile lies inside the grid', ({ design }) => {
        const outside = tilesOf(design).filter(({ tile }) => {
            const [x, y] = tile.split('-').map(Number);
            return x >= design.grid.x_size || y >= design.grid.y_size;
        });

        expect(outside).toEqual([]);
    });

    // The renderer labels a tile from the first list that names it, so a duplicate hides one type.
    it.each(baked)('$name: no tile is listed as two node types', ({ design }) => {
        const listByTile = new Map<string, string>();
        const duplicates = tilesOf(design).filter(({ list, tile }) => {
            const earlier = listByTile.get(tile);
            listByTile.set(tile, earlier ?? list);
            return earlier !== undefined;
        });

        expect(duplicates).toEqual([]);
    });

    it.each(baked)('$name: passes the validator a report-supplied descriptor must pass', ({ design }) => {
        expect(parseSocDescriptorOverride(design).status).toBe('valid');
    });

    // The perf default restates the mesh size by hand; keep the two in step until it reads the descriptor.
    it.each([DeviceArchitecture.QUASAR, DeviceArchitecture.GRENDEL])(
        "%s: the core-count default is its default part's worker count",
        (arch) => {
            expect(resolveMaxCores({ architecture: arch }, [])).toBe(getChipDesign(arch)?.functional_workers.length);
        },
    );
});
