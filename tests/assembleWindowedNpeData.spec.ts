// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import assembleWindowedNpeData, { buildTimestepSkeleton } from '../src/functions/assembleWindowedNpeData';
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

describe('buildTimestepSkeleton', () => {
    it('expands the columnar summary into per-step aggregates with no heavy payload', () => {
        const skeleton = buildTimestepSkeleton(makeSummary());

        expect(skeleton).toHaveLength(3);
        const idle = skeleton[2];
        expect(idle.start_cycle).toBe(20);
        expect(idle.avg_link_demand).toBe(3);
        expect(idle.max_link_demand).toBe(9);
        expect(idle.active_transfers).toEqual([]);
        expect(idle.link_demand).toEqual([]);
    });
});

describe('assembleWindowedNpeData', () => {
    const skeletonFor = (summary = makeSummary()) => buildTimestepSkeleton(summary);

    it('patches the visited step with the window payload by default', () => {
        const summary = makeSummary();
        const data = assembleWindowedNpeData(summary, makeWindow(1), skeletonFor(summary));
        const visited = data.timestep_data[1];

        expect(visited.active_transfers).toEqual([0, 1]);
        expect(visited.link_demand).toHaveLength(1);
        expect(visited.avg_link_demand).toBe(20);
        expect(visited.noc[NoCType.NOC0].avg_link_demand).toBe(11);
        expect(data.noc_transfers).toHaveLength(2);
    });

    it('does not mutate the shared skeleton (safe to reuse across scrubs)', () => {
        const summary = makeSummary();
        const skeleton = skeletonFor(summary);
        assembleWindowedNpeData(summary, makeWindow(1), skeleton);

        // The reused skeleton keeps step 1 empty despite the patch on the result.
        expect(skeleton[1].active_transfers).toEqual([]);
        expect(skeleton[1].link_demand).toEqual([]);
    });

    it('row-clones link_demand so NPEView annotations do not leak into the cached window', () => {
        const summary = makeSummary();
        const window = makeWindow(1);
        const data = assembleWindowedNpeData(summary, window, skeletonFor(summary));
        const row = data.timestep_data[1].link_demand[0];

        // Distinct tuple instances, equal contents.
        expect(row).not.toBe(window.timestep.link_demand[0]);
        expect(row).toEqual(window.timestep.link_demand[0]);

        // Mutating the assembled row (as NPEView's FABRIC_EVENT_SCOPE write does)
        // leaves the staleTime:Infinity window array untouched.
        row[5] = 1;
        expect(window.timestep.link_demand[0][5]).toBeUndefined();
    });

    it('patches at the requested render index when the window is stale (keeps the prior frame)', () => {
        // Seek to step 2 while the in-flight window still holds step 1's data:
        // the rendered step (2) shows the previous transfers instead of empty.
        const summary = makeSummary();
        const data = assembleWindowedNpeData(summary, makeWindow(1), skeletonFor(summary), 2);

        expect(data.timestep_data[2].active_transfers).toEqual([0, 1]);
        // The window's own index is not double-patched.
        expect(data.timestep_data[1].active_transfers).toEqual([]);
    });

    it('emits undefined zones when the summary has none, and passes them through otherwise', () => {
        const empty = makeSummary({ zones: [] });
        expect(assembleWindowedNpeData(empty, makeWindow(), skeletonFor(empty)).zones).toBeUndefined();

        const zones = [{ zones: [], proc: 'BRISC', core: [0, 0, 0] }] as unknown as NPERootZone[];
        const withZones = makeSummary({ zones });
        expect(assembleWindowedNpeData(withZones, makeWindow(), skeletonFor(withZones)).zones).toBe(zones);
    });
});
