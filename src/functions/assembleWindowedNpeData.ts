// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { NPEData, NoCType, NpeSummary, NpeWindow, TimestepData } from '../model/NPEModel';

// #861 windowed loading: reconstructs a renderer-ready NPEData for a single
// visited timestep. Every step carries its heat-bar aggregates from the summary
// (so the timeline scrubber draws the whole trace), while only the visited step
// carries the heavy `link_demand` + active transfers fetched from the window.
const assembleWindowedNpeData = (summary: NpeSummary, window: NpeWindow): NPEData => {
    const timestepData: TimestepData[] = summary.timesteps.map((step) => ({
        start_cycle: step.start_cycle,
        end_cycle: step.end_cycle,
        active_transfers: [],
        link_demand: [],
        max_link_demand: step.max_link_demand,
        avg_link_demand: step.avg_link_demand,
        avg_link_util: step.avg_link_util,
        mcast_write_link_util: step.mcast_write_link_util,
        noc: {
            [NoCType.NOC0]: { avg_link_demand: 0, avg_link_util: 0 },
            [NoCType.NOC1]: { avg_link_demand: 0, avg_link_util: 0 },
        },
    }));

    const visited = timestepData[window.t];
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
        zones: summary.zones,
        noc_transfers: window.transfers,
        timestep_data: timestepData,
    };
};

export default assembleWindowedNpeData;
