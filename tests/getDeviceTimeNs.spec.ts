// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import getDeviceTimeNs from '../src/functions/getDeviceTimeNs';
import { ColumnKeys, Columns } from '../src/definitions/PerfTable';

describe('getDeviceTimeNs', () => {
    it('reads device_time in µs, the unit the perf table shows Device Time in', () => {
        expect(Columns.find((column) => column.key === ColumnKeys.DeviceTime)?.unit).toBe('µs');
        expect(getDeviceTimeNs({ device_time: 370 })).toBe(370_000);
        expect(getDeviceTimeNs({ device_time: 0.5 })).toBe(500);
    });

    it('keeps a zero device time as 0 ns, so the charts plot it rather than leave a gap', () => {
        expect(getDeviceTimeNs({ device_time: 0 })).toBe(0);
    });

    it.each([
        ['no device time', null],
        ['an unparsed device time', Number.NaN],
        ['an infinite device time', Number.POSITIVE_INFINITY],
    ])('has no duration for %s', (_, deviceTime) => {
        expect(getDeviceTimeNs({ device_time: deviceTime })).toBeNull();
    });
});
