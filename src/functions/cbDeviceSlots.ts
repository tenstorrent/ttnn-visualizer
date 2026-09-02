// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The device/repeat bookkeeping that decides how many devices a circular buffer
 * row stands for. Shared by `processMemoryAllocations` (the per-DeviceOp legend and
 * the pressure modal, #1844) and `collapseCbDeviceRows` (the L1 plot legend, #1879)
 * so the three surfaces cannot disagree about a CB's device count — they were
 * separate implementations agreeing only on the sentinel below.
 */

// Keeps a graph with no device dimension accumulating into one bucket. #1844
export const SINGLE_DEVICE_KEY = 'single';

/**
 * @description Normalise a graph node's `device_id` to a number. `undefined` when
 * absent or not a finite number — the field is missing in older captures and
 * emitted as a string by at least one other. #1844
 */
export const normaliseDeviceId = (deviceId: number | string | undefined | null): number | undefined => {
    if (deviceId === undefined || deviceId === null || deviceId === '') {
        return undefined;
    }
    const asNumber = Number(deviceId);
    return Number.isFinite(asNumber) ? asNumber : undefined;
};

/**
 * @description Bucket key for the device a CB was allocated on. Normalises first so
 * a raw graph value and an already-normalised one land in the same bucket: without
 * that, one caller reading `params.device_id` and another reading a parsed field
 * disagreed on anything unparseable.
 */
export const cbDeviceKey = (deviceId: number | string | undefined | null): string => {
    const normalised = normaliseDeviceId(deviceId);
    return normalised === undefined ? SINGLE_DEVICE_KEY : String(normalised);
};

/**
 * @description Slot allocator for one CB scope. Call the returned function per CB
 * with its identity and device key; CBs that fold onto one row share a slot.
 *
 * A repeat on the same device is a real second allocation rather than mesh fan-out,
 * so keying on the device's own repeat count gives it its own slot and pairs it with
 * the other devices' repeats instead of letting it displace the first.
 */
export const createCbSlotKeys = (): ((identity: string, deviceKey: string) => string) => {
    const repeatsByDevice = new Map<string, number>();
    return (identity: string, deviceKey: string): string => {
        const repeatKey = `${identity}|${deviceKey}`;
        const repeat = (repeatsByDevice.get(repeatKey) ?? 0) + 1;
        repeatsByDevice.set(repeatKey, repeat);
        return `${identity}|${repeat}`;
    };
};
