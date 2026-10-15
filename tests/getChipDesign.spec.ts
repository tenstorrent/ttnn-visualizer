// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { DeviceArchitecture } from '../src/definitions/DeviceArchitecture';
import { getChipDesign } from '../src/functions/getChipDesign';

// `null`, not an empty stand-in: the stand-in claimed the required fields of `ChipDesign`
// without having them, so callers each invented their own "did this resolve?" probe
// (`design === NO_CHIP_DESIGN`, `design.eth?.length`, `design.arch_name === undefined`).
// One of those probes only agreed with the others because every baked descriptor happens
// to carry a non-empty eth list. #1772

describe('getChipDesign', () => {
    it('returns the baked descriptor for a supported arch', () => {
        expect(getChipDesign(DeviceArchitecture.WORMHOLE)?.arch_name).toBe('WORMHOLE');
        expect(getChipDesign(DeviceArchitecture.BLACKHOLE)?.arch_name).toBe('BLACKHOLE');
        expect(getChipDesign(DeviceArchitecture.QUASAR)?.arch_name).toBe('QUASAR');
    });

    // Values from tt-metal `soc_descriptors/quasar_32_arch.yaml` at 7d54a363f0c. When updating them,
    // re-transcribe from tt-metal rather than editing the JSON until this passes. #1847
    it('bakes Quasar-32 as tt-metal describes it: a Tensix-only emulation part', () => {
        const quasar = getChipDesign(DeviceArchitecture.QUASAR);
        const workers = [2, 3, 4, 5].flatMap((y) => [2, 3, 4, 5, 6, 7, 8, 9].map((x) => `${x}-${y}`));

        expect(quasar?.grid).toEqual({ x_size: 11, y_size: 8 });
        expect(quasar?.functional_workers).toEqual(workers);
        expect(quasar?.dram).toEqual([['2-7'], ['4-0']]);
        expect(quasar?.dispatch).toEqual(['10-1', '10-6', '1-6']);
        expect(quasar?.router_only).toEqual(['0-2']);
        expect(quasar?.worker_l1_size).toBe(4_194_304);
        expect(quasar?.eth).toEqual([]);
        expect(quasar?.pcie).toEqual([]);
        expect(quasar?.arc).toEqual([]);
    });

    it('returns null for an arch with no baked descriptor', () => {
        expect(getChipDesign(DeviceArchitecture.UNKNOWN)).toBeNull();
    });

    // Consumers memoise on the descriptor identity, so a fresh object per call would
    // invalidate those memos on every render.
    it('returns a stable identity across calls', () => {
        expect(getChipDesign(DeviceArchitecture.WORMHOLE)).toBe(getChipDesign(DeviceArchitecture.WORMHOLE));
    });

    // The eth list is what Cluster indexes by channel for coordinate labels, and a design
    // whose list were empty would be indistinguishable from an unresolved arch under the
    // predicate this change removed.
    it('carries a non-empty channel-indexed eth list for every supported arch', () => {
        expect(getChipDesign(DeviceArchitecture.WORMHOLE)?.eth?.length).toBeGreaterThan(0);
        expect(getChipDesign(DeviceArchitecture.BLACKHOLE)?.eth?.length).toBeGreaterThan(0);
    });
});
