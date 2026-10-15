// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NPEView from '../src/components/npe/NPEViewComponent';
import { NPEData } from '../src/model/NPEModel';
import { ToastType } from '../src/definitions/ToastType';

const { createToast, useNodeTypeMock, chipSizes } = vi.hoisted(() => ({
    createToast: vi.fn(),
    useNodeTypeMock: vi.fn(),
    chipSizes: [] as { width: number; height: number }[],
}));

vi.mock('../src/components/npe/RouteOriginsRenderer', () => ({ RouteOriginsRenderer: () => null }));
vi.mock('../src/components/npe/NPETimelineComponent', () => ({ default: () => null }));
vi.mock('../src/components/npe/ChipCongestionCanvas', () => ({ default: () => null }));
vi.mock('../src/components/npe/TensixTransferRenderer', () => ({ default: () => null }));
vi.mock('../src/components/npe/ActiveTransferDetails', () => ({ default: () => null }));
vi.mock('../src/components/npe/NPEMetadata', () => ({ default: () => null }));
vi.mock('../src/components/npe/EmptyChipRenderer', () => ({
    EmptyChipRenderer: ({ width, height }: { width: number; height: number }) => {
        chipSizes.push({ width, height });
        return null;
    },
}));
vi.mock('../src/components/npe/NPEZoneFilterComponent', () => ({ default: () => null }));
vi.mock('../src/components/GlobalSwitch', () => ({ default: () => null }));
vi.mock('../src/functions/createToastNotification', async () => {
    const { toastNotificationModuleMock } = await import('./helpers/mockToastNotification');

    return toastNotificationModuleMock(createToast);
});
vi.mock('../src/components/npe/useNPEHandlers', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/components/npe/useNPEHandlers')>()),
    useSelectedTransferGrouping: () => ({ transferListSelectionRendering: new Map(), groupedTransfersByNoCID: {} }),
}));
vi.mock('../src/hooks/useAPI', () => ({ useNodeType: useNodeTypeMock }));

const QUASAR_32_GRID = { x_size: 11, y_size: 8 };

const resolved = (overrides: Record<string, unknown> = {}) => ({
    architecture: { arch_name: 'QUASAR', grid: QUASAR_32_GRID },
    grid: QUASAR_32_GRID,
    cores: [[2, 2]],
    dram: [[7, 2]],
    eth: [],
    pcie: [],
    dispatch: [[1, 10]],
    overrideProblems: null,
    gridMismatch: null,
    ...overrides,
});

const makeNpeData = (columns: number, rows: number): NPEData =>
    ({
        common_info: { arch: 'quasar', version: '1.0.0', cycles_per_timestep: 1, num_cols: columns, num_rows: rows },
        chips: { '0': [0, 0, 0, 0] },
        noc_transfers: [],
        timestep_data: [{ start_cycle: 0, end_cycle: 9, active_transfers: [], link_demand: [] }],
        zones: [],
    }) as unknown as NPEData;

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    chipSizes.length = 0;
});

describe('NPEView SoC descriptor presentation (#1847)', () => {
    it("checks the baked descriptor against the report's own grid", () => {
        useNodeTypeMock.mockReturnValue(resolved());

        render(<NPEView npeData={makeNpeData(11, 8)} />);

        expect(useNodeTypeMock).toHaveBeenCalledWith('quasar', undefined, { x_size: 11, y_size: 8 });
        expect(chipSizes.at(-1)).toEqual({ width: 11, height: 8 });
    });

    // tt-npe embeds the descriptor it ran with in every Quasar trace, so this is the usual path.
    it("passes the report's own SoC descriptor along with its grid", () => {
        useNodeTypeMock.mockReturnValue(resolved());
        const descriptor = { grid: { x_size: 2, y_size: 3 }, functional_workers: ['0-1', '1-1'] };

        render(<NPEView npeData={{ ...makeNpeData(2, 3), soc_descriptor: descriptor }} />);

        expect(useNodeTypeMock).toHaveBeenCalledWith('quasar', descriptor, { x_size: 2, y_size: 3 });
    });

    it('explains a grid mismatch and draws the report at its own size', () => {
        useNodeTypeMock.mockReturnValue(
            resolved({
                architecture: null,
                grid: { x_size: 2, y_size: 3 },
                cores: undefined,
                dispatch: undefined,
                gridMismatch: { baked: QUASAR_32_GRID, reported: { x_size: 2, y_size: 3 } },
            }),
        );

        render(<NPEView npeData={makeNpeData(2, 3)} />);

        expect(createToast).toHaveBeenCalledWith(
            'SoC descriptor does not match this report',
            expect.stringContaining("This report's grid is 2x3, but the built-in quasar descriptor is 11x8"),
            ToastType.WARNING,
        );
        expect(createToast).not.toHaveBeenCalledWith('Unsupported architecture', expect.anything(), expect.anything());
        expect(chipSizes.at(-1)).toEqual({ width: 2, height: 3 });
    });

    it('notes a descriptor with no Ethernet or PCIe tiles while cores are annotated', () => {
        useNodeTypeMock.mockReturnValue(resolved());

        render(<NPEView npeData={makeNpeData(11, 8)} />);

        expect(screen.getByText('No Ethernet or PCIe')).toBeTruthy();

        fireEvent.click(screen.getByLabelText('Annotate cores'));

        expect(screen.queryByText('No Ethernet or PCIe')).toBeNull();
    });

    it.each([
        ['Ethernet and PCIe', { eth: [[0, 1]], pcie: [[3, 0]] }],
        ['Ethernet only', { eth: [[0, 1]] }],
        ['PCIe only', { pcie: [[3, 0]] }],
    ])('does not note a descriptor with %s tiles', (_label, tiles) => {
        useNodeTypeMock.mockReturnValue(resolved(tiles));

        render(<NPEView npeData={makeNpeData(11, 8)} />);

        expect(screen.queryByText('No Ethernet or PCIe')).toBeNull();
    });

    it('does not note an unresolved arch, which has no descriptor at all', () => {
        useNodeTypeMock.mockReturnValue(
            resolved({ architecture: null, grid: null, cores: undefined, dispatch: undefined }),
        );

        render(<NPEView npeData={makeNpeData(11, 8)} />);

        expect(screen.queryByText('No Ethernet or PCIe')).toBeNull();
    });
});
