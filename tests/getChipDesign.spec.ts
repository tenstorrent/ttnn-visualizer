// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { DeviceArchitecture } from '../src/definitions/DeviceArchitecture';
import { findBakedChipDesign, getBakedChipDesigns, getChipDesign } from '../src/functions/getChipDesign';
import { QSR3A2_GRID, QUASAR_32_GRID } from './helpers/quasarGrids';

// `null`, not an empty stand-in: the stand-in claimed the required fields of `ChipDesign`
// without having them, so callers each invented their own "did this resolve?" probe
// (`design === NO_CHIP_DESIGN`, `design.eth?.length`, `design.arch_name === undefined`).
// One of those probes only agreed with the others because every baked descriptor happens
// to carry a non-empty eth list. #1772

// The 8x4 Tensix mesh Quasar-32 and Grendel share, and each QSR3.A2 die repeats.
const quasarMeshWorkers = (rows: number[]) => rows.flatMap((y) => [2, 3, 4, 5, 6, 7, 8, 9].map((x) => `${x}-${y}`));
const QUASAR_MESH_WORKERS = quasarMeshWorkers([2, 3, 4, 5]);

describe('getChipDesign', () => {
    it('returns the baked descriptor for a supported arch', () => {
        expect(getChipDesign(DeviceArchitecture.WORMHOLE)?.arch_name).toBe('WORMHOLE');
        expect(getChipDesign(DeviceArchitecture.BLACKHOLE)?.arch_name).toBe('BLACKHOLE');
        expect(getChipDesign(DeviceArchitecture.QUASAR)?.arch_name).toBe('QUASAR');
        expect(getChipDesign(DeviceArchitecture.GRENDEL)?.arch_name).toBe('GRENDEL');
    });

    // Values from tt-metal `soc_descriptors/quasar_32_arch.yaml` at 7d54a363f0c. When updating them,
    // re-transcribe from tt-metal rather than editing the JSON until this passes. #1847
    it('bakes Quasar-32 as tt-metal describes it: a Tensix-only emulation part', () => {
        const quasar = getChipDesign(DeviceArchitecture.QUASAR);

        expect(quasar?.grid).toEqual({ x_size: 11, y_size: 8 });
        expect(quasar?.functional_workers).toEqual(QUASAR_MESH_WORKERS);
        expect(quasar?.dram).toEqual([['2-7'], ['4-0']]);
        expect(quasar?.dispatch).toEqual(['10-1', '10-6', '1-6']);
        expect(quasar?.router_only).toEqual(['0-2']);
        expect(quasar?.worker_l1_size).toBe(4_194_304);
        expect(quasar?.eth).toEqual([]);
        expect(quasar?.pcie).toEqual([]);
        expect(quasar?.arc).toEqual([]);
    });

    // Values from tt-metal `soc_descriptors/quasar_qsr3a2_arch.yaml` at 252c3e74847. When updating them,
    // re-transcribe from tt-metal rather than editing the JSON until this passes. #2237
    it('bakes QSR3.A2 as tt-metal describes it: three Quasar dies in one NoC space', () => {
        const qsr3a2 = findBakedChipDesign(DeviceArchitecture.QUASAR, QSR3A2_GRID);

        expect(qsr3a2?.arch_name).toBe('QUASAR');
        expect(qsr3a2?.grid).toEqual(QSR3A2_GRID);
        // Rows 6-7 and 12-13 between the dies carry the D2D links, not workers.
        expect(qsr3a2?.functional_workers).toEqual(quasarMeshWorkers([2, 3, 4, 5, 8, 9, 10, 11, 14, 15, 16, 17]));
        expect(qsr3a2?.dram).toEqual([
            ['1-4'],
            ['1-5'],
            ['10-2'],
            ['10-3'],
            ['1-10'],
            ['1-11'],
            ['10-8'],
            ['10-9'],
            ['1-16'],
            ['1-17'],
            ['10-14'],
            ['10-15'],
        ]);
        expect(qsr3a2?.dispatch).toEqual(['1-6', '1-1', '10-1', '1-12', '1-7', '10-7', '1-18', '1-13', '10-13']);
        expect(qsr3a2?.router_only).toEqual([]);
        expect(qsr3a2?.worker_l1_size).toBe(4_194_304);
        expect(qsr3a2?.eth).toEqual([]);
        expect(qsr3a2?.pcie).toEqual([]);
        expect(qsr3a2?.arc).toEqual([]);
        expect(qsr3a2?.harvested_workers).toEqual([]);
        expect(qsr3a2?.dram_bank_size).toBe(1_073_741_824);
        expect(qsr3a2?.features).toEqual({
            unpacker: { version: 1, inline_srca_trans_without_srca_trans_instr: false },
            math: { dst_size_alignment: 32768 },
            packer: { version: 1 },
            overlay: { version: 1 },
        });
    });

    // Derived at tt-umd a5d92b1e58b by decoding `grendel_qsr1_att_map.hpp` words as x = (w & 0x3f) - 2,
    // y = (w >> 6) - 2. Re-derive from tt-umd rather than editing the JSON until this passes. #2130
    it('bakes Grendel qsr.s1 as derived from the tt-umd address map', () => {
        const grendel = getChipDesign(DeviceArchitecture.GRENDEL);
        // The SMU at 1-1 and the rest of the ring around the Quasar mesh, less the dispatch corners.
        const ring = [
            ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((x) => `${x}-1`),
            ...[2, 3, 4, 5].flatMap((y) => [`1-${y}`, `10-${y}`]),
            ...[2, 3, 4, 5, 6, 7, 8, 9].map((x) => `${x}-6`),
        ];

        // Grid from tt-umd's `grendel_implementation.hpp` GRID_SIZE, not the map.
        expect(grendel?.grid).toEqual({ x_size: 12, y_size: 8 });
        expect(grendel?.functional_workers).toEqual(QUASAR_MESH_WORKERS);
        // A Mimir fronts its DRAM over two D2D links, so each channel lists two tiles.
        expect(grendel?.dram).toEqual([
            ['4-7', '5-7'],
            ['8-7', '9-7'],
            ['7-0', '6-0'],
            ['3-0', '2-0'],
        ]);
        // Not in the tt-umd map: tt-metal's `grendel_qsr1_att_config.h` DISPATCH_ENTRIES (full-tile selectors 56-58).
        expect(grendel?.dispatch).toEqual(['10-1', '10-6', '1-6']);
        expect([...(grendel?.router_only ?? [])].sort()).toEqual([...ring].sort());
        // Keraunos sits outside the mesh at x 11, and the map does not carry its tiles.
        expect(grendel?.eth).toEqual([]);
        expect(grendel?.pcie).toEqual([]);
        expect(grendel?.arc).toEqual([]);
    });

    it('returns null for an arch with no baked descriptor', () => {
        expect(getChipDesign(DeviceArchitecture.UNKNOWN)).toBeNull();
        expect(findBakedChipDesign(DeviceArchitecture.UNKNOWN, QUASAR_32_GRID)).toBeNull();
        expect(getBakedChipDesigns(DeviceArchitecture.UNKNOWN)).toEqual([]);
    });

    // Both report `quasar`, so the grid is all that tells them apart. #2237
    it('finds the Quasar part baked on the given grid', () => {
        expect(findBakedChipDesign(DeviceArchitecture.QUASAR, QSR3A2_GRID)?.grid).toEqual(QSR3A2_GRID);
        expect(findBakedChipDesign(DeviceArchitecture.QUASAR, QUASAR_32_GRID)?.grid).toEqual(QUASAR_32_GRID);
    });

    it('lists Quasar-32 first, as the default for a caller with no grid', () => {
        expect(getBakedChipDesigns(DeviceArchitecture.QUASAR).map((design) => design.grid)).toEqual([
            QUASAR_32_GRID,
            QSR3A2_GRID,
        ]);
        expect(getChipDesign(DeviceArchitecture.QUASAR)?.grid).toEqual(QUASAR_32_GRID);
    });

    // No fallback to the default: a part drawn on the wrong grid would label tiles it does not have.
    it('finds nothing on a grid no part of the arch is baked on', () => {
        expect(findBakedChipDesign(DeviceArchitecture.QUASAR, { x_size: 2, y_size: 3 })).toBeNull();
        expect(findBakedChipDesign(DeviceArchitecture.QUASAR, { x_size: 12, y_size: 8 })).toBeNull();
        // Transposed: the same cell count on the wrong axes.
        expect(findBakedChipDesign(DeviceArchitecture.QUASAR, { x_size: 19, y_size: 12 })).toBeNull();
        expect(findBakedChipDesign(DeviceArchitecture.GRENDEL, QSR3A2_GRID)).toBeNull();
    });

    // Consumers memoise on the descriptor identity, so a fresh object per call would
    // invalidate those memos on every render.
    it('returns a stable identity across calls', () => {
        expect(getChipDesign(DeviceArchitecture.WORMHOLE)).toBe(getChipDesign(DeviceArchitecture.WORMHOLE));
        expect(findBakedChipDesign(DeviceArchitecture.QUASAR, { ...QSR3A2_GRID })).toBe(
            findBakedChipDesign(DeviceArchitecture.QUASAR, { ...QSR3A2_GRID }),
        );
    });

    // The eth list is what Cluster indexes by channel for coordinate labels, and a design
    // whose list were empty would be indistinguishable from an unresolved arch under the
    // predicate this change removed.
    it('carries a non-empty channel-indexed eth list for every supported arch', () => {
        expect(getChipDesign(DeviceArchitecture.WORMHOLE)?.eth?.length).toBeGreaterThan(0);
        expect(getChipDesign(DeviceArchitecture.BLACKHOLE)?.eth?.length).toBeGreaterThan(0);
    });
});
