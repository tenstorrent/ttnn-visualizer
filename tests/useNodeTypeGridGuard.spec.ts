// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useNodeType } from '../src/hooks/useAPI';
import { DeviceArchitecture } from '../src/definitions/DeviceArchitecture';
import npeDemoSingle from '../src/assets/data/npe-demo-single.json';

// The 2x3 Quasar simulator's descriptor, as tt-npe embeds it: another grid reporting `quasar`.
const quasar2x3Descriptor = {
    arch_name: 'quasar',
    grid: { x_size: 2, y_size: 3 },
    functional_workers: ['0-1', '1-1'],
    dram: [['0-0'], ['1-0']],
    pcie: ['1-2'],
    dispatch: ['0-2'],
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('useNodeType grid guard (#1847)', () => {
    it('draws a Quasar-32 report on the baked descriptor, dispatch engines included', () => {
        const { result } = renderHook(() =>
            useNodeType(DeviceArchitecture.QUASAR, undefined, { x_size: 11, y_size: 8 }),
        );

        expect(result.current.gridMismatch).toBeNull();
        expect(result.current.grid).toEqual({ x_size: 11, y_size: 8 });
        expect(result.current.cores).toHaveLength(32);
        // [y, x] pairs, as the grid renderer indexes them.
        expect(result.current.dispatch).toEqual([
            [1, 10],
            [6, 10],
            [6, 1],
        ]);
    });

    it.each([
        ['both axes', { x_size: 2, y_size: 3 }],
        ['only the rows', { x_size: 11, y_size: 4 }],
        ['only the columns', { x_size: 10, y_size: 8 }],
    ])('withholds the baked descriptor from a report that differs in %s', (_label, reported) => {
        // A 2x3 trace drawn on Quasar-32 would label tiles that do not exist on its chip.
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { result } = renderHook(() => useNodeType(DeviceArchitecture.QUASAR, undefined, reported));

        expect(result.current.architecture).toBeNull();
        expect(result.current.cores).toBeUndefined();
        expect(result.current.gridMismatch).toEqual({ baked: { x_size: 11, y_size: 8 }, reported });
        expect(consoleError).toHaveBeenCalledWith(
            `Baked quasar SoC descriptor is 11x8, but the report's grid is ${reported.x_size}x${reported.y_size}`,
        );
        // Not also the generic message: the arch is supported, the grid is not.
        expect(consoleError).not.toHaveBeenCalledWith('Unsupported arch: quasar');
    });

    it('draws a withheld report at its own size, not a default one', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const { result } = renderHook(() =>
            useNodeType(DeviceArchitecture.QUASAR, undefined, { x_size: 2, y_size: 3 }),
        );

        expect(result.current.grid).toEqual({ x_size: 2, y_size: 3 });
    });

    it("draws a report on its own descriptor whatever the baked one's grid", () => {
        const { result } = renderHook(() =>
            useNodeType(DeviceArchitecture.QUASAR, quasar2x3Descriptor, { x_size: 2, y_size: 3 }),
        );

        expect(result.current.gridMismatch).toBeNull();
        expect(result.current.grid).toEqual({ x_size: 2, y_size: 3 });
        expect(result.current.dispatch).toEqual([[2, 0]]);
    });

    it('sizes an unknown arch from its own grid rather than failing on the missing baked one', () => {
        // No baked descriptor to compare against, so this is the "unsupported" path, at the report's size.
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { result } = renderHook(() =>
            useNodeType('horizon_xyz' as DeviceArchitecture, undefined, { x_size: 10, y_size: 12 }),
        );

        expect(result.current.architecture).toBeNull();
        expect(result.current.gridMismatch).toBeNull();
        expect(result.current.grid).toEqual({ x_size: 10, y_size: 12 });
        expect(consoleError).toHaveBeenCalledWith('Unsupported arch: horizon_xyz');
    });

    it.each([
        ['no grid', undefined],
        ['a zero axis', { x_size: 0, y_size: 8 }],
        ['a non-integer axis', { x_size: 2.5, y_size: 3 }],
        ['an axis that is not a number', { x_size: '2' as unknown as number, y_size: 3 }],
        ['a grid above the renderer cap', { x_size: 1_000_000, y_size: 3 }],
    ])('keeps the baked descriptor when the report gives %s', (_label, reportedGrid) => {
        const { result } = renderHook(() => useNodeType(DeviceArchitecture.QUASAR, undefined, reportedGrid));

        expect(result.current.gridMismatch).toBeNull();
        expect(result.current.grid).toEqual({ x_size: 11, y_size: 8 });
    });

    it('leaves a real single-chip Wormhole trace on its baked descriptor', () => {
        const { arch, num_cols: columns, num_rows: rows } = npeDemoSingle.common_info;

        const { result } = renderHook(() =>
            useNodeType(arch as DeviceArchitecture, undefined, { x_size: columns, y_size: rows }),
        );

        expect(result.current.gridMismatch).toBeNull();
        expect(result.current.cores?.length).toBeGreaterThan(0);
    });

    // Not only Quasar: baked labels on a grid of another size would be wrong for any arch.
    it('withholds the Wormhole descriptor from a trace on a non-standard grid', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const { result } = renderHook(() =>
            useNodeType(DeviceArchitecture.WORMHOLE, undefined, { x_size: 8, y_size: 8 }),
        );

        expect(result.current.architecture).toBeNull();
        expect(result.current.gridMismatch).toEqual({
            baked: { x_size: 10, y_size: 12 },
            reported: { x_size: 8, y_size: 8 },
        });
    });

    it('finds the baked descriptor whatever the arch name casing', () => {
        const { result } = renderHook(() =>
            useNodeType('QUASAR' as DeviceArchitecture, undefined, { x_size: 11, y_size: 8 }),
        );

        expect(result.current.gridMismatch).toBeNull();
        expect(result.current.cores).toHaveLength(32);
    });

    it('reports an unusable descriptor ahead of a grid mismatch when both apply', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { result } = renderHook(() =>
            useNodeType(DeviceArchitecture.QUASAR, { grid: 'nonsense' }, { x_size: 2, y_size: 3 }),
        );

        expect(result.current.overrideProblems).not.toBeNull();
        expect(result.current.architecture).toBeNull();
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Unusable SoC descriptor in report'));
        expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('Baked quasar SoC descriptor'));
    });

    it('leaves Wormhole and Blackhole reports on their baked descriptors', () => {
        // tt-npe writes the model's own rows and columns, which match the baked grids.
        const wormhole = renderHook(() =>
            useNodeType(DeviceArchitecture.WORMHOLE, undefined, { x_size: 10, y_size: 12 }),
        );
        const blackhole = renderHook(() =>
            useNodeType(DeviceArchitecture.BLACKHOLE, undefined, { x_size: 17, y_size: 12 }),
        );

        expect(wormhole.result.current.gridMismatch).toBeNull();
        expect(wormhole.result.current.cores).toHaveLength(80);
        expect(blackhole.result.current.gridMismatch).toBeNull();
        expect(blackhole.result.current.architecture).not.toBeNull();
    });

    it('keeps the same mismatch and grid objects across renders while the grid is unchanged', () => {
        // NPE re-renders per playback tick and toasts from an effect keyed on this value.
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const { result, rerender } = renderHook(() =>
            useNodeType(DeviceArchitecture.QUASAR, undefined, { x_size: 2, y_size: 3 }),
        );
        const { gridMismatch, grid } = result.current;
        rerender();

        expect(result.current.gridMismatch).toBe(gridMismatch);
        expect(result.current.grid).toBe(grid);
    });
});

describe('useNodeType with the derived Grendel descriptor (#2130)', () => {
    it('draws a Grendel report on its baked descriptor', () => {
        const { result } = renderHook(() =>
            useNodeType(DeviceArchitecture.GRENDEL, undefined, { x_size: 12, y_size: 8 }),
        );

        expect(result.current.gridMismatch).toBeNull();
        expect(result.current.cores).toHaveLength(32);
        expect(result.current.dram).toHaveLength(8);
        expect(result.current.dispatch).toHaveLength(3);
    });

    // UMD reads `quasar` without an `ip_variant` as Grendel (tt-umd#3587); this deliberately doesn't, since no
    // report carries that variant yet and tt-sim's Quasar-32 lays out its DRAM differently. #2130
    it('does not pick the Grendel descriptor for a quasar report on its grid', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const { result } = renderHook(() =>
            useNodeType(DeviceArchitecture.QUASAR, undefined, { x_size: 12, y_size: 8 }),
        );

        expect(result.current.architecture).toBeNull();
        expect(result.current.gridMismatch?.baked).toEqual({ x_size: 11, y_size: 8 });
    });
});
