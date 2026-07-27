// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import validateNpeWindow from '../src/functions/validateNpeWindow';

const validWindow = () => ({
    t: 3,
    transfers: [],
    timestep: {
        active_transfers: [1, 2],
        link_demand: [[0, 0, 0, 'NOC0_IN', 12.5, undefined]],
        avg_link_demand: 0,
        avg_link_util: 0,
        mcast_write_link_util: 0,
        noc: {},
    },
});

describe('validateNpeWindow', () => {
    it('accepts a well-formed window', () => {
        expect(validateNpeWindow(validWindow())).toBeNull();
    });

    it('rejects non-object input', () => {
        expect(validateNpeWindow(null)).toMatch(/not an object/);
        expect(validateNpeWindow('nope')).toMatch(/not an object/);
    });

    it('rejects a missing or invalid timestep index', () => {
        const w = validWindow();
        expect(validateNpeWindow({ ...w, t: undefined })).toMatch(/timestep index/);
        expect(validateNpeWindow({ ...w, t: -1 })).toMatch(/timestep index/);
        expect(validateNpeWindow({ ...w, t: 2.5 })).toMatch(/timestep index/);
    });

    it('rejects a missing transfers array', () => {
        const w = validWindow();
        expect(validateNpeWindow({ ...w, transfers: undefined })).toMatch(/transfers array/);
    });

    it('rejects a missing timestep payload', () => {
        const w = validWindow();
        expect(validateNpeWindow({ ...w, timestep: undefined })).toMatch(/timestep payload/);
    });

    it('rejects a timestep missing its arrays', () => {
        const w = validWindow();
        expect(validateNpeWindow({ ...w, timestep: { ...w.timestep, active_transfers: undefined } })).toMatch(
            /active_transfers array/,
        );
        expect(validateNpeWindow({ ...w, timestep: { ...w.timestep, link_demand: 'nope' } })).toMatch(
            /link_demand array/,
        );
    });
});
