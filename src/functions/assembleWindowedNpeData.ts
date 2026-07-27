// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { LinkUtilization, NPEData, NoCType, NpeSummary, NpeWindow, TimestepData } from '../model/NPEModel';

// #861 windowed loading: builds the per-step aggregate skeleton once from the
// summary. Every step carries only its heat-bar aggregates (empty link_demand /
// active_transfers); the visited step's heavy payload is patched in later by
// `assembleWindowedNpeData`. Memoize this on the summary — it must NOT be rebuilt
// per scrub, and the timeline consumes it as a stable reference so its
// O(n_timesteps) heat-bar memo runs once per report instead of once per seek.
export const buildTimestepSkeleton = (summary: NpeSummary): TimestepData[] => {
    const columns = summary.timesteps;
    return columns.start_cycle.map((startCycle, index) => ({
        start_cycle: startCycle,
        end_cycle: columns.end_cycle[index],
        active_transfers: [],
        link_demand: [],
        max_link_demand: columns.max_link_demand[index],
        avg_link_demand: columns.avg_link_demand[index],
        avg_link_util: columns.avg_link_util[index],
        mcast_write_link_util: columns.mcast_write_link_util[index],
        noc: {
            [NoCType.NOC0]: { avg_link_demand: 0, avg_link_util: 0 },
            [NoCType.NOC1]: { avg_link_demand: 0, avg_link_util: 0 },
        },
    }));
};

// Reconstructs a renderer-ready NPEData for a single visited timestep by
// shallow-cloning the pre-built `baseTimestepData` skeleton and patching only the
// visited step with the window's transfers + link_demand. This keeps per-scrub
// work at one array copy + one object clone instead of rebuilding all ~54k step
// objects, and leaves `baseTimestepData` untouched so the timeline can reuse it.
//
// `visitedIndex` defaults to the window's own timestep, but the container passes
// the currently-rendered `selectedTimestep`: while a seek's window is in flight
// `useNpeWindow` serves the previous window (keepPreviousData), so patching that
// data at the rendered step keeps the prior frame on screen instead of flashing
// empty until the matching window resolves.
const assembleWindowedNpeData = (
    summary: NpeSummary,
    window: NpeWindow,
    baseTimestepData: TimestepData[],
    visitedIndex = window.t,
): NPEData => {
    const timestepData = baseTimestepData.slice();
    const base = timestepData[visitedIndex];
    if (base) {
        timestepData[visitedIndex] = {
            ...base,
            active_transfers: window.timestep.active_transfers,
            // Row-clone the link_demand tuples: NPEView's `links` memo annotates
            // FABRIC_EVENT_SCOPE in place, and the window array lives in the
            // staleTime:Infinity React Query cache — mutating it directly would
            // persist stale scope across report revisits. The clone is per-scrub
            // (a few hundred 6-tuples) and negligible next to the paint cost.
            link_demand: window.timestep.link_demand.map((row) => [...row] as LinkUtilization),
            avg_link_demand: window.timestep.avg_link_demand,
            avg_link_util: window.timestep.avg_link_util,
            mcast_write_link_util: window.timestep.mcast_write_link_util,
            noc: window.timestep.noc,
        };
    }

    return {
        common_info: summary.common_info,
        chips: summary.chips,
        zones: summary.zones?.length ? summary.zones : undefined,
        noc_transfers: window.transfers,
        timestep_data: timestepData,
    };
};

export default assembleWindowedNpeData;
