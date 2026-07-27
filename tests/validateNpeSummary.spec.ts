// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import validateNpeSummary from '../src/functions/validateNpeSummary';

const validColumns = (n: number) => ({
    start_cycle: Array.from({ length: n }, (_, i) => i),
    end_cycle: Array.from({ length: n }, (_, i) => i + 1),
    avg_link_demand: Array.from({ length: n }, () => 0),
    avg_link_util: Array.from({ length: n }, () => 0),
    max_link_demand: Array.from({ length: n }, () => 0),
    mcast_write_link_util: Array.from({ length: n }, () => 0),
    active_count: Array.from({ length: n }, () => 0),
});

const validSummary = (n = 3) => ({
    common_info: { version: '1.0.0' },
    chips: {},
    zones: [],
    n_timesteps: n,
    timesteps: validColumns(n),
});

describe('validateNpeSummary', () => {
    it('accepts a well-formed columnar summary', () => {
        expect(validateNpeSummary(validSummary())).toBeNull();
    });

    it('rejects non-object input', () => {
        expect(validateNpeSummary(null)).toMatch(/not an object/);
        expect(validateNpeSummary('nope')).toMatch(/not an object/);
    });

    it('accepts an empty (zero-timestep) trace', () => {
        expect(validateNpeSummary(validSummary(0))).toBeNull();
    });

    it('rejects a missing or negative timestep count', () => {
        const s = validSummary();
        expect(validateNpeSummary({ ...s, n_timesteps: -1 })).toMatch(/timestep count/);
        expect(validateNpeSummary({ ...s, n_timesteps: undefined })).toMatch(/timestep count/);
        expect(validateNpeSummary({ ...s, n_timesteps: 1.5 })).toMatch(/timestep count/);
    });

    it('rejects missing timestep columns', () => {
        const s = validSummary();
        expect(validateNpeSummary({ ...s, timesteps: undefined })).toMatch(/missing timestep columns/);
    });

    it('rejects a length-mismatched column', () => {
        const s = validSummary(3);
        s.timesteps.active_count = [0, 0]; // one short
        expect(validateNpeSummary(s)).toMatch(/active_count.*length-mismatched/);
    });

    it('rejects a non-array column', () => {
        const s = validSummary(3);
        (s.timesteps as Record<string, unknown>).max_link_demand = 'not-an-array';
        expect(validateNpeSummary(s)).toMatch(/max_link_demand/);
    });
});
