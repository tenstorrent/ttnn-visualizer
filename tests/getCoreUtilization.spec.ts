// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import getCoreUtilization from '../src/functions/getCoreUtilization';
import { TypedPerfTableRow } from '../src/model/PerfTable';

const MAX_CORES = 64;

const makeRow = (overrides: Partial<TypedPerfTableRow> = {}): TypedPerfTableRow =>
    ({
        pm_ideal_ns: 300,
        device_time: 10,
        cores: 64,
        available_cores: null,
        ...overrides,
    }) as TypedPerfTableRow;

describe('getCoreUtilization', () => {
    it('divides the ideal time by the device time, scaled by the cores the op could have used', () => {
        expect(getCoreUtilization(makeRow(), MAX_CORES)).toBeCloseTo(0.03);
        expect(getCoreUtilization(makeRow({ cores: 32 }), MAX_CORES)).toBeCloseTo(0.06);
        expect(getCoreUtilization(makeRow({ cores: 32, available_cores: 128 }), MAX_CORES)).toBeCloseTo(0.12);
    });

    it('is unknown, not near zero, when the ideal time is the perf model placeholder', () => {
        expect(getCoreUtilization(makeRow({ pm_ideal_ns: 1, device_time: 127 }), MAX_CORES)).toBeNull();
    });

    it('keeps a modelled ideal time however short', () => {
        expect(getCoreUtilization(makeRow({ pm_ideal_ns: 2, device_time: 1 }), MAX_CORES)).toBeCloseTo(0.002);
    });

    it.each([
        ['no ideal time', { pm_ideal_ns: null }],
        ['no device time', { device_time: null }],
        ['an unparsed device time', { device_time: Number.NaN }],
        ['a zero device time', { device_time: 0 }],
        ['no core count', { cores: null }],
        ['a zero core count', { cores: 0 }],
    ])('is unknown, not zero, with %s', (_, overrides) => {
        expect(getCoreUtilization(makeRow(overrides), MAX_CORES)).toBeNull();
    });

    it('is zero for a modelled ideal time of zero', () => {
        expect(getCoreUtilization(makeRow({ pm_ideal_ns: 0 }), MAX_CORES)).toBe(0);
    });
});
