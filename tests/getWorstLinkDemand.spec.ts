// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import getWorstLinkDemand from '../src/functions/getWorstLinkDemand';
import { LinkUtilization, NoCID } from '../src/model/NPEModel';

const row = (demand: number): LinkUtilization => [0, 0, 0, NoCID.NOC1_IN, demand, undefined];

describe('getWorstLinkDemand', () => {
    it('returns the max demand across non-empty rows (ignoring the scalar)', () => {
        expect(getWorstLinkDemand([row(3), row(12.5), row(7)], 99)).toBe(12.5);
    });

    it('falls back to the per-step scalar when there are no rows (windowed-out step)', () => {
        expect(getWorstLinkDemand([], 8)).toBe(8);
    });

    it('returns -1 when there are no rows and no scalar (idle/unknown)', () => {
        expect(getWorstLinkDemand([], undefined)).toBe(-1);
        expect(getWorstLinkDemand([], null)).toBe(-1);
    });

    it('never returns -Infinity for an empty row set', () => {
        expect(getWorstLinkDemand([], undefined)).not.toBe(-Infinity);
    });
});
