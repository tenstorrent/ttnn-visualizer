// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { NPEData, NoCType, NpeSummary, NpeWindow, TimestepData } from '../model/NPEModel';

// #861 windowed loading: reconstructs a renderer-ready NPEData for a single
// visited timestep. Every step carries its heat-bar aggregates from the summary
// (so the timeline scrubber draws the whole trace), while only the visited step
// carries the heavy `link_demand` + active transfers fetched from the window.
//
// `visitedIndex` defaults to the window's own timestep, but the container passes
// the currently-rendered `selectedTimestep`: while a seek's window is in flight
// `useNpeWindow` serves the previous window (keepPreviousData), so patching that
// data at the rendered step keeps the prior frame on screen instead of flashing
// empty until the matching window resolves.
const assembleWindowedNpeData = (summary: NpeSummary, window: NpeWindow, visitedIndex = window.t): NPEData => {
    const columns = summary.timesteps;
    const timestepData: TimestepData[] = columns.start_cycle.map((startCycle, index) => ({
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

    const visited = timestepData[visitedIndex];
    if (visited) {
        visited.active_transfers = window.timestep.active_transfers;
        visited.link_demand = window.timestep.link_demand;
        visited.avg_link_demand = window.timestep.avg_link_demand;
        visited.avg_link_util = window.timestep.avg_link_util;
        visited.mcast_write_link_util = window.timestep.mcast_write_link_util;
        visited.noc = window.timestep.noc;
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
