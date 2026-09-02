// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { collapseCbDeviceRows, normaliseDeviceId } from '../src/functions/collapseCbDeviceRows';
import type { CircularBuffer } from '../src/model/APIData';

const cb = (overrides: Partial<CircularBuffer> = {}): CircularBuffer => ({
    address: 111616,
    size: 8192,
    core_range_set: '{[0-1 - 10-4], [0-5 - 5-5]}',
    num_cores: 46,
    globallyAllocated: false,
    ...overrides,
});

/** The op-104 shape from `test_ttnn_moe_aug26_2217`: one CB emitted per device. */
const acrossDevices = (count: number, overrides: Partial<CircularBuffer> = {}): CircularBuffer[] =>
    Array.from({ length: count }, (_, device) => cb({ device_id: device, ...overrides }));

describe('normaliseDeviceId', () => {
    it('accepts the number and string forms tt-metal emits', () => {
        // Absent in older captures, a string in at least one other. #1844
        expect(normaliseDeviceId(0)).toBe(0);
        expect(normaliseDeviceId(31)).toBe(31);
        expect(normaliseDeviceId('12')).toBe(12);
    });

    it('is undefined for anything that is not a device id', () => {
        expect(normaliseDeviceId(undefined)).toBeUndefined();
        expect(normaliseDeviceId('')).toBeUndefined();
        expect(normaliseDeviceId('not a number')).toBeUndefined();
    });
});

describe('collapseCbDeviceRows', () => {
    it('folds a mesh op’s fan-out into one row carrying the device count', () => {
        // Reported from op 104 of the MoE report: 96 CB nodes = 3 CBs x 32 devices,
        // which the L1 legend drew as 96 unlabelled rows. #1879
        const collapsed = collapseCbDeviceRows(acrossDevices(32));

        expect(collapsed).toHaveLength(1);
        expect(collapsed[0].deviceCount).toBe(32);
        expect(collapsed[0].address).toBe(111616);
    });

    it('keeps distinct CBs apart while collapsing each one', () => {
        const collapsed = collapseCbDeviceRows([
            ...acrossDevices(32, { address: 111616, size: 8192 }),
            ...acrossDevices(32, { address: 119808, size: 487424 }),
            ...acrossDevices(32, { address: 607232, size: 917504 }),
        ]);

        expect(collapsed.map((entry) => [entry.address, entry.deviceCount])).toEqual([
            [111616, 32],
            [119808, 32],
            [607232, 32],
        ]);
    });

    it('gives a second allocation on the same device its own row', () => {
        // A repeat on one device is a real second allocation, not fan-out, so it
        // must not collapse onto the first — and it pairs with the other devices'
        // repeats rather than displacing them.
        const collapsed = collapseCbDeviceRows([
            cb({ device_id: 0 }),
            cb({ device_id: 1 }),
            cb({ device_id: 0 }),
            cb({ device_id: 1 }),
        ]);

        expect(collapsed).toHaveLength(2);
        expect(collapsed.map((entry) => entry.deviceCount)).toEqual([2, 2]);
    });

    it('separates CBs that differ only in core range or aliasing', () => {
        const collapsed = collapseCbDeviceRows([
            ...acrossDevices(4, { core_range_set: '{[0-0 - 1-1]}' }),
            ...acrossDevices(4, { core_range_set: '{[0-0 - 3-3]}' }),
            ...acrossDevices(4, { globallyAllocated: true }),
        ]);

        expect(collapsed).toHaveLength(3);
        expect(collapsed.every((entry) => entry.deviceCount === 4)).toBe(true);
    });

    it('leaves a single-device capture as one row with no fan-out', () => {
        // Older captures carry no device_id at all; they must not report 1 device
        // per row and must not merge two genuinely separate allocations.
        const collapsed = collapseCbDeviceRows([cb(), cb({ address: 200000 })]);

        expect(collapsed).toHaveLength(2);
        expect(collapsed.map((entry) => entry.deviceCount)).toEqual([1, 1]);
    });

    it('cannot collapse fan-out when a capture carries no device id, so keeps the rows', () => {
        // Without a device id every emission looks like a repeat on the same
        // device. Fan-out and a genuine second allocation are indistinguishable, so
        // the rows are preserved rather than merged on a guess — such a capture sees
        // no improvement here, which is the honest outcome rather than a wrong count.
        const collapsed = collapseCbDeviceRows([cb(), cb()]);

        expect(collapsed).toHaveLength(2);
        expect(collapsed.map((entry) => entry.deviceCount)).toEqual([1, 1]);
    });

    it('returns nothing for an operation with no circular buffers', () => {
        expect(collapseCbDeviceRows([])).toEqual([]);
    });

    it('does not mutate the list it was given', () => {
        const cbList = acrossDevices(4);

        collapseCbDeviceRows(cbList);

        expect(cbList).toHaveLength(4);
        expect(cbList.every((entry) => !('deviceCount' in entry))).toBe(true);
    });
});
