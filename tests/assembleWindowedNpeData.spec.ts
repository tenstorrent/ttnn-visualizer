// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import assembleWindowedNpeData from '../src/functions/assembleWindowedNpeData';
import { CommonInfo, NPERootZone, NoCID, NoCTransfer, NoCType, NpeSummary, NpeWindow } from '../src/model/NPEModel';

const makeSummary = (overrides: Partial<NpeSummary> = {}): NpeSummary => ({
    common_info: { version: '1.0.0' } as CommonInfo,
    chips: {},
    zones: [],
    n_timesteps: 3,
    timesteps: {
        start_cycle: [0, 10, 20],
        end_cycle: [9, 19, 29],
        avg_link_demand: [1, 2, 3],
        avg_link_util: [4, 5, 6],
        max_link_demand: [7, 8, 9],
        mcast_write_link_util: [0.1, 0.2, 0.3],
        active_count: [0, 2, 0],
    },
    ...overrides,
});

const makeWindow = (t = 1): NpeWindow => ({
    t,
    timestep: {
        active_transfers: [0, 1],
        link_demand: [[0, 0, 0, NoCID.NOC0_EAST, 50, undefined]],
        max_link_demand: 8,
        avg_link_demand: 20,
        avg_link_util: 21,
        mcast_write_link_util: 0.9,
        noc: {
            [NoCType.NOC0]: { avg_link_demand: 11, avg_link_util: 12 },
            [NoCType.NOC1]: { avg_link_demand: 0, avg_link_util: 0 },
        },
    },
    transfers: [{ id: 0 }, { id: 1 }] as unknown as NoCTransfer[],
});

describe('assembleWindowedNpeData', () => {
    it('expands columnar summary into per-step aggregates', () => {
        const data = assembleWindowedNpeData(makeSummary(), makeWindow());

        expect(data.timestep_data).toHaveLength(3);
        const idle = data.timestep_data[2];
        expect(idle.start_cycle).toBe(20);
        expect(idle.avg_link_demand).toBe(3);
        expect(idle.max_link_demand).toBe(9);
        // Non-visited steps carry no heavy per-link payload.
        expect(idle.active_transfers).toEqual([]);
        expect(idle.link_demand).toEqual([]);
    });

    it('patches the visited step with the window payload by default', () => {
        const data = assembleWindowedNpeData(makeSummary(), makeWindow(1));
        const visited = data.timestep_data[1];

        expect(visited.active_transfers).toEqual([0, 1]);
        expect(visited.link_demand).toHaveLength(1);
        expect(visited.avg_link_demand).toBe(20);
        expect(visited.noc[NoCType.NOC0].avg_link_demand).toBe(11);
        expect(data.noc_transfers).toHaveLength(2);
    });

    it('patches at the requested render index when the window is stale (keeps the prior frame)', () => {
        // Seek to step 2 while the in-flight window still holds step 1's data:
        // the rendered step (2) shows the previous transfers instead of empty.
        const data = assembleWindowedNpeData(makeSummary(), makeWindow(1), 2);

        expect(data.timestep_data[2].active_transfers).toEqual([0, 1]);
        // The window's own index is not double-patched.
        expect(data.timestep_data[1].active_transfers).toEqual([]);
    });

    it('emits undefined zones when the summary has none, and passes them through otherwise', () => {
        expect(assembleWindowedNpeData(makeSummary({ zones: [] }), makeWindow()).zones).toBeUndefined();

        const zones = [{ zones: [], proc: 'BRISC', core: [0, 0, 0] }] as unknown as NPERootZone[];
        expect(assembleWindowedNpeData(makeSummary({ zones }), makeWindow()).zones).toBe(zones);
    });
});
