// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import validateNpeWindow from '../src/functions/validateNpeWindow';

const validWindow = () => ({
    t: 3,
    transfers: [{ id: 0, route: [] }],
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

    it('accepts a 5-tuple link_demand row (real report shape, no scope slot)', () => {
        const w = validWindow();
        w.timestep.link_demand = [[0, 0, 0, 'NOC0_IN', 12.5]] as never;
        expect(validateNpeWindow(w)).toBeNull();
    });

    it('rejects a malformed link_demand row', () => {
        const w = validWindow();
        expect(validateNpeWindow({ ...w, timestep: { ...w.timestep, link_demand: [[0, 0, 0, 'NOC0_IN']] } })).toMatch(
            /link_demand row is malformed/,
        );
        expect(validateNpeWindow({ ...w, timestep: { ...w.timestep, link_demand: [[0, 0, 0, 42, 12.5]] } })).toMatch(
            /non-string NOC id/,
        );
        expect(
            validateNpeWindow({ ...w, timestep: { ...w.timestep, link_demand: [[0, 0, 0, 'NOC0_IN', 'x']] } }),
        ).toMatch(/non-numeric demand/);
    });

    it('rejects malformed transfers', () => {
        const w = validWindow();
        expect(validateNpeWindow({ ...w, transfers: [{ route: [] }] })).toMatch(/numeric id/);
        expect(validateNpeWindow({ ...w, transfers: [{ id: 0 }] })).toMatch(/route array/);
    });

    it('accepts a well-formed route entry', () => {
        const w = validWindow();
        const route = { links: [], injection_rate: 1.5, src: [0, 0, 0], dst: [[0, 1, 1]] };
        expect(validateNpeWindow({ ...w, transfers: [{ id: 0, route: [route] }] })).toBeNull();
    });

    it('rejects a malformed route entry (unguarded downstream reads)', () => {
        const w = validWindow();
        const base = { links: [], injection_rate: 1.5, src: [0, 0, 0], dst: [[0, 1, 1]] };
        expect(validateNpeWindow({ ...w, transfers: [{ id: 0, route: [null] }] })).toMatch(/malformed route entry/);
        expect(validateNpeWindow({ ...w, transfers: [{ id: 0, route: [{ ...base, links: 'nope' }] }] })).toMatch(
            /links array/,
        );
        expect(validateNpeWindow({ ...w, transfers: [{ id: 0, route: [{ ...base, injection_rate: 'x' }] }] })).toMatch(
            /non-numeric injection_rate/,
        );
        expect(validateNpeWindow({ ...w, transfers: [{ id: 0, route: [{ ...base, dst: undefined }] }] })).toMatch(
            /src\/dst coordinates/,
        );
    });
});
