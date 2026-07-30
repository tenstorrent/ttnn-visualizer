// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NPEZoneFilterComponent from '../src/components/npe/NPEZoneFilterComponent';
import { KERNEL_PROCESS, NPEData, NPERootZone, NPEZone } from '../src/model/NPEModel';

// Collapsed zone rows used to stay mounted: a large report held ~218k of them, and
// React re-diffed that whole host tree on every NPEView render (~1.4 s per scrub,
// click or hover). These tests pin the fix at the feature level. #1803

const makeZone = (id: string, children: NPEZone[] = []): NPEZone => ({
    id,
    zones: children,
    start: 0,
    end: 10,
    depth: 0,
});

const makeRootZone = (proc: KERNEL_PROCESS, core: [number, number, number], zoneCount: number): NPERootZone => ({
    proc,
    core,
    zones: Array.from({ length: zoneCount }, (_, i) => makeZone(`${proc}-KERNEL[${i}]`)),
});

const makeNpeData = (zones: NPERootZone[]): NPEData =>
    ({
        common_info: { arch: 'wormhole_b0', version: '1.0.0', cycles_per_timestep: 1 },
        chips: { '0': [0, 0, 0, 0] },
        noc_transfers: [],
        timestep_data: [],
        zones,
    }) as unknown as NPEData;

const renderPanel = (zones: NPERootZone[]) =>
    render(
        <NPEZoneFilterComponent
            npeData={makeNpeData(zones)}
            open
            onClose={vi.fn()}
            onSelect={vi.fn()}
            onExpand={vi.fn()}
            onZoneClick={vi.fn()}
        />,
    );

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('NPE zone filter collapsed zones', () => {
    it('mounts no zone rows while every root zone is collapsed', () => {
        renderPanel([
            makeRootZone(KERNEL_PROCESS.BRISC, [0, 2, 1], 25),
            makeRootZone(KERNEL_PROCESS.NCRISC, [0, 2, 2], 25),
        ]);

        expect(document.querySelectorAll('.zone-interactive')).toHaveLength(0);
    });

    it('still lists every root zone so they remain expandable', () => {
        renderPanel([
            makeRootZone(KERNEL_PROCESS.BRISC, [0, 2, 1], 25),
            makeRootZone(KERNEL_PROCESS.NCRISC, [0, 2, 2], 25),
        ]);

        expect(document.querySelectorAll('.root-zone-collapsible')).toHaveLength(2);
        expect(screen.getByRole('button', { name: /BRISC 0-2-1/ })).toBeTruthy();
    });

    it('mounts only the expanded root zone’s rows when one is opened', () => {
        renderPanel([
            makeRootZone(KERNEL_PROCESS.BRISC, [0, 2, 1], 3),
            makeRootZone(KERNEL_PROCESS.NCRISC, [0, 2, 2], 25),
        ]);

        fireEvent.click(screen.getByRole('button', { name: /BRISC 0-2-1/ }));

        // Only the opened root zone contributes rows — the other stays unmounted.
        expect(document.querySelectorAll('.zone-interactive')).toHaveLength(3);
        expect(screen.getByText(/BRISC-KERNEL\[0\]/)).toBeTruthy();
    });

    it('does not mount rows for zones nested inside a collapsed root zone', () => {
        const nested = makeZone('BRISC-KERNEL[0]', [makeZone('BRISC-INNER[0]')]);
        renderPanel([{ proc: KERNEL_PROCESS.BRISC, core: [0, 2, 1], zones: [nested] }]);

        expect(document.querySelectorAll('.zone-interactive')).toHaveLength(0);
    });
});
