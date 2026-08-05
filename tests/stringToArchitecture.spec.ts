// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { DeviceArchitecture } from '../src/definitions/DeviceArchitecture';
import { stringToArchitecture } from '../src/functions/stringToArchitecture';

// Cluster resolves a baked descriptor per chip from this result, so an arch that resolves
// to the wrong family mislabels eth coordinates and PCIe markers rather than omitting
// them. The values here are the ones cluster_descriptor.yaml actually carries. #1772

describe('stringToArchitecture', () => {
    it('resolves the revision-suffixed names descriptors carry', () => {
        expect(stringToArchitecture('wormhole_b0')).toBe(DeviceArchitecture.WORMHOLE);
        expect(stringToArchitecture('blackhole')).toBe(DeviceArchitecture.BLACKHOLE);
    });

    it('is case insensitive', () => {
        expect(stringToArchitecture('WORMHOLE_B0')).toBe(DeviceArchitecture.WORMHOLE);
        expect(stringToArchitecture('Blackhole')).toBe(DeviceArchitecture.BLACKHOLE);
    });

    it('does not resolve a name that merely contains an arch', () => {
        // Substring matching used to resolve these, so an unknown arch borrowed Wormhole's
        // eth list instead of dropping its enrichment.
        expect(stringToArchitecture('nonwormhole_b0')).toBe(DeviceArchitecture.UNKNOWN);
        expect(stringToArchitecture('notblackhole')).toBe(DeviceArchitecture.UNKNOWN);
    });

    it('reports an unrecognised or absent arch as unknown', () => {
        expect(stringToArchitecture('quasar')).toBe(DeviceArchitecture.UNKNOWN);
        expect(stringToArchitecture('')).toBe(DeviceArchitecture.UNKNOWN);
    });

    // The descriptor is uploaded and reaches us through `yaml.safe_load`, which does no schema
    // validation: a bare `arch: 1` or a nested map both parse. Calling `.toLowerCase()` on one
    // throws, and the nearest boundary is the router's root `errorElement`, which replaces the
    // whole app shell rather than degrading the cluster view.
    it('treats a non-string arch as unknown instead of throwing', () => {
        expect(stringToArchitecture(undefined)).toBe(DeviceArchitecture.UNKNOWN);
        expect(stringToArchitecture(null)).toBe(DeviceArchitecture.UNKNOWN);
        expect(stringToArchitecture(1)).toBe(DeviceArchitecture.UNKNOWN);
        expect(stringToArchitecture({ name: 'wormhole_b0' })).toBe(DeviceArchitecture.UNKNOWN);
        expect(stringToArchitecture(['wormhole_b0'])).toBe(DeviceArchitecture.UNKNOWN);
    });
});
