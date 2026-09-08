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
