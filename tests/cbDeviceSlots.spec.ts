// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { SINGLE_DEVICE_KEY, cbDeviceKey, createCbSlotKeys, normaliseDeviceId } from '../src/functions/cbDeviceSlots';

describe('normaliseDeviceId', () => {
    it('accepts the number and string forms tt-metal emits', () => {
        expect(normaliseDeviceId(0)).toBe(0);
        expect(normaliseDeviceId(31)).toBe(31);
        expect(normaliseDeviceId('12')).toBe(12);
    });

    it('is undefined for anything that is not a device id', () => {
        expect(normaliseDeviceId(undefined)).toBeUndefined();
        expect(normaliseDeviceId(null)).toBeUndefined();
        expect(normaliseDeviceId('')).toBeUndefined();
        expect(normaliseDeviceId('abc')).toBeUndefined();
    });
});

describe('cbDeviceKey', () => {
    it('buckets absent and unparseable ids together', () => {
        // The divergence this shared helper exists to remove: one caller read
        // `params.device_id` raw and the other a normalised field, so a capture mixing
        // '' with 'abc' produced two rows of one device on one surface and one row of
        // two devices on the other.
        expect(cbDeviceKey(undefined)).toBe(SINGLE_DEVICE_KEY);
        expect(cbDeviceKey('')).toBe(SINGLE_DEVICE_KEY);
        expect(cbDeviceKey('abc')).toBe(SINGLE_DEVICE_KEY);
    });

    it('is idempotent, so a raw and an already-normalised id agree', () => {
        expect(cbDeviceKey('7')).toBe(cbDeviceKey(7));
        expect(cbDeviceKey(normaliseDeviceId('7'))).toBe(cbDeviceKey('7'));
    });
});

describe('createCbSlotKeys', () => {
    it('folds every device onto one slot for the same identity', () => {
        const slotKeyOf = createCbSlotKeys();

        const slots = ['0', '1', '2', '3'].map((device) => slotKeyOf('cb-a', device));

        expect(new Set(slots).size).toBe(1);
    });

    it('gives a repeat on the same device its own slot', () => {
        const slotKeyOf = createCbSlotKeys();

        const first = slotKeyOf('cb-a', '0');
        const second = slotKeyOf('cb-a', '0');

        expect(second).not.toBe(first);
    });

    it('pairs the nth repeat across devices rather than letting it displace the first', () => {
        const slotKeyOf = createCbSlotKeys();

        const deviceZeroFirst = slotKeyOf('cb-a', '0');
        const deviceOneFirst = slotKeyOf('cb-a', '1');
        const deviceZeroSecond = slotKeyOf('cb-a', '0');
        const deviceOneSecond = slotKeyOf('cb-a', '1');

        expect(deviceOneFirst).toBe(deviceZeroFirst);
        expect(deviceOneSecond).toBe(deviceZeroSecond);
        expect(deviceZeroSecond).not.toBe(deviceZeroFirst);
    });

    it('keeps distinct identities apart', () => {
        const slotKeyOf = createCbSlotKeys();

        expect(slotKeyOf('cb-a', '0')).not.toBe(slotKeyOf('cb-b', '0'));
    });

    it('starts a fresh count per allocator, so one scope cannot leak into the next', () => {
        expect(createCbSlotKeys()('cb-a', '0')).toBe(createCbSlotKeys()('cb-a', '0'));
    });
});
