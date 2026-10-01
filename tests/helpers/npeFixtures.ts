// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type CommonInfo, type NPEData, NoCType, type NpeSummary, type NpeWindow } from '../../src/model/NPEModel';

/** Minimal well-formed whole-file NPE payload for parse / validate / route specs. */
export const minimalValidNpeData = {
    common_info: { version: '1.0.0' },
    noc_transfers: [{ id: 0 }],
    timestep_data: [{ active_transfers: [] }],
} as unknown as NPEData;

/** Windowed-path summary: three timesteps, the first populated one at t=1. */
export const summary: NpeSummary = {
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
};

/** Window for t=1 matching `summary`. */
export const npeWindow: NpeWindow = {
    t: 1,
    timestep: {
        active_transfers: [],
        link_demand: [],
        max_link_demand: 8,
        avg_link_demand: 20,
        avg_link_util: 21,
        mcast_write_link_util: 0.9,
        noc: {
            [NoCType.NOC0]: { avg_link_demand: 0, avg_link_util: 0 },
            [NoCType.NOC1]: { avg_link_demand: 0, avg_link_util: 0 },
        },
    },
    transfers: [],
};
