// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { CircularBuffer } from '../model/APIData';
import { cbDeviceKey, createCbSlotKeys } from './cbDeviceSlots';

export { normaliseDeviceId } from './cbDeviceSlots';

export interface CollapsedCircularBuffer extends CircularBuffer {
    /** Devices this row stands for. 1 when the capture carries no device dimension. */
    deviceCount: number;
}

/**
 * @description Collapse one device operation's circular buffers so a mesh op's
 * fan-out is a single row carrying a device count, instead of the same CB listed
 * once per device. #1879
 *
 * The identity and repeat scheme mirrors `processMemoryAllocations`, which already
 * does this for the per-DeviceOp legend and the pressure modal (#1844) — the three
 * surfaces are on screen together and must not disagree about how many devices a CB
 * spans. Op scoping is implicit here because `cbList` is already per operation.
 *
 * A second allocation of the same CB *on one device* is a real allocation rather
 * than fan-out, so it keeps its own row: keying on the device's repeat count pairs
 * it with the other devices' repeats instead of letting it collapse onto the first.
 * The first occurrence in graph order is the row the rest fold onto.
 */
export const collapseCbDeviceRows = (cbList: readonly CircularBuffer[]): CollapsedCircularBuffer[] => {
    const slotKeyOf = createCbSlotKeys();
    const slotOrder: string[] = [];
    const bySlot = new Map<string, { circularBuffer: CircularBuffer; deviceKeys: Set<string> }>();

    for (const circularBuffer of cbList) {
        const identity = [
            circularBuffer.address,
            circularBuffer.size,
            circularBuffer.core_range_set,
            circularBuffer.globallyAllocated === true,
        ].join('|');
        const deviceKey = cbDeviceKey(circularBuffer.device_id);
        const slot = slotKeyOf(identity, deviceKey);
        const existing = bySlot.get(slot);
        if (existing) {
            existing.deviceKeys.add(deviceKey);
        } else {
            bySlot.set(slot, { circularBuffer, deviceKeys: new Set([deviceKey]) });
            slotOrder.push(slot);
        }
    }

    return slotOrder.map((slot) => {
        const entry = bySlot.get(slot);
        return { ...(entry?.circularBuffer as CircularBuffer), deviceCount: entry?.deviceKeys.size ?? 1 };
    });
};
