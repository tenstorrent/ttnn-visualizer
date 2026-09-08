// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClusterRenderer from '../src/components/cluster/ClusterRenderer';
import type { ClusterTopology } from '../src/model/ClusterModel';

// Placement is where the condensed layout actually happens — the group gutter, the
// per-host offset and the mesh-coords guard — and none of it was exercised. Same
// harness as ClusterUnknownArch.spec.tsx. #1948
let topologyOverride: ClusterTopology | null = null;

vi.mock('react-router', async () => ({
    ...(await vi.importActual<typeof import('react-router')>('react-router')),
    useNavigate: () => vi.fn(),
}));
vi.mock('../src/hooks/useAPI', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/hooks/useAPI')>()),
    useGetClusterTopology: () => ({
        data: topologyOverride,
        isLoading: false,
        isError: false,
        error: null,
    }),
}));

/* eslint-disable class-methods-use-this -- no-op stub has nothing to hold */
class ResizeObserverStub {
    observe() {}

    unobserve() {}

    disconnect() {}
}
/* eslint-enable class-methods-use-this */

interface HostSpec {
    rank: number;
    chipCount: number;
    /** Board slot per chip; omitted means the descriptor carries none. */
    slots?: boolean;
    /** Mesh coordinates per chip, which outrank grouping when every host has them. */
    mesh?: boolean;
}

const topologyOf = (hosts: HostSpec[]): ClusterTopology =>
    ({
        isMultiHost: hosts.length > 1,
        worldSize: hosts.length,
        unresolvedRemoteCount: 0,
        hosts: hosts.map(({ rank, chipCount, slots, mesh }) => {
            const chipIds = Array.from({ length: chipCount }, (_, chip) => chip);
            return {
                rank,
                descriptor: {
                    arch: Object.fromEntries(chipIds.map((chip) => [chip, 'wormhole_b0'])),
                    chip_unique_ids: Object.fromEntries(chipIds.map((chip) => [chip, String(rank * 100 + chip)])),
                    chips_with_mmio: [{ 0: 0 }],
                    ethernet_connections: [],
                    ...(slots ? { asic_locations: Object.fromEntries(chipIds.map((c) => [c, (c % 8) + 1])) } : {}),
                },
                meshChips: mesh ? Object.fromEntries(chipIds.map((c) => [c, [c, rank, 0, 0]])) : {},
            };
        }),
        intraHostLinks: [],
        interHostLinks: [],
    }) as unknown as ClusterTopology;

/** `{ "<rank>-<chipId>": [column, row] }`, 1-based as CSS grid reports them. */
const placements = (): Record<string, [number, number]> => {
    const found: Record<string, [number, number]> = {};
    for (const cell of document.querySelectorAll<HTMLElement>('[data-rank]')) {
        const id = cell.querySelector('.chip-id')?.textContent?.replace('Device ', '').trim();
        if (id !== undefined && cell.style.gridColumn) {
            found[`${cell.getAttribute('data-rank')}-${id}`] = [
                Number(cell.style.gridColumn),
                Number(cell.style.gridRow),
            ];
        }
    }
    return found;
};

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    topologyOverride = null;
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('condensed placement', () => {
    it('tiles a slotless host four wide in id order', () => {
        topologyOverride = topologyOf([{ rank: 0, chipCount: 6 }]);

        render(<ClusterRenderer />);
        const at = placements();

        expect(at['0-0'][0]).toBe(at['0-4'][0]);
        expect(at['0-4'][1]).toBe(at['0-0'][1] + 1);
        expect(at['0-3'][0]).toBe(at['0-0'][0] + 3);
    });

    it('leaves a blank row between board groups', () => {
        // Two groups of eight, two rows each. Chip 8 opens the second group, so it
        // sits three rows below chip 0 rather than two — the gutter is the extra one.
        topologyOverride = topologyOf([{ rank: 0, chipCount: 16, slots: true }]);

        render(<ClusterRenderer />);
        const at = placements();

        expect(at['0-8'][1] - at['0-0'][1]).toBe(3);
        const occupiedRows = new Set(Object.values(at).map(([, row]) => row));
        // The gutter row itself holds nothing.
        expect(occupiedRows.has(at['0-0'][1] + 2)).toBe(false);
    });

    it('lets mesh coordinates outrank board-slot grouping', () => {
        // The guard that keeps mesh reports unchanged: slots are present and would
        // group, but every host has mesh coords so they must win.
        topologyOverride = topologyOf([{ rank: 0, chipCount: 16, slots: true, mesh: true }]);

        render(<ClusterRenderer />);
        const at = placements();

        // Mesh puts chip c at x = c, so the row never advances and no gutter appears.
        expect(at['0-8'][1]).toBe(at['0-0'][1]);
        expect(at['0-8'][0]).toBe(at['0-0'][0] + 8);
    });

    it('offsets a second host below the first, sizing each by its own tier', () => {
        // Rank 0 groups (16 chips, 2 groups, 5 rows with the gutter); rank 1 does
        // not (6 chips, 2 rows). Both hostRows branches in one pass.
        topologyOverride = topologyOf([
            { rank: 0, chipCount: 16, slots: true },
            { rank: 1, chipCount: 6 },
        ]);

        render(<ClusterRenderer />);
        const at = placements();

        // Host order is not rank order — with no inter-host links the proximity
        // sort is free to put either first — so this asserts the invariant that
        // holds either way: the two blocks do not overlap and a blank row divides
        // them, with each block sized by the tier its own host reached.
        const rowsOf = (rank: string) =>
            Object.entries(at)
                .filter(([key]) => key.startsWith(`${rank}-`))
                .map(([, position]) => position[1]);
        const span = (rank: string) => ({ top: Math.min(...rowsOf(rank)), bottom: Math.max(...rowsOf(rank)) });
        const [first, second] = span('0').top < span('1').top ? [span('0'), span('1')] : [span('1'), span('0')];

        expect(first.bottom).toBeLessThan(second.top);
        // Exactly one empty row between the two hosts.
        expect(second.top - first.bottom).toBe(2);
        // Grouped host spans 5 rows (2 groups x 2 rows + 1 gutter); the slotless
        // one spans 2. Both hostRows branches, in one render.
        const spans = [first.bottom - first.top + 1, second.bottom - second.top + 1].sort((a, b) => a - b);
        expect(spans).toEqual([2, 5]);
    });
});
