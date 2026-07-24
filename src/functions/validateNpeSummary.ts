// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { NpeSummary } from '../model/NPEModel';

const SUMMARY_COLUMNS = [
    'start_cycle',
    'end_cycle',
    'avg_link_demand',
    'avg_link_util',
    'max_link_demand',
    'mcast_write_link_util',
    'active_count',
] as const;

// Guards the columnar wire contract (#861): the windowed summary indexes every
// column by timestep `t`, so a partial / corrupt / untrusted response with a
// missing, non-array, or length-mismatched column would silently mis-render the
// timeline and scrubber. Returns a human-readable error string, or null when the
// shape is sound. Enforced at the React Query fetch boundary so failures surface
// through the existing error Callout rather than as wrong graph data.
export default function validateNpeSummary(data: unknown): string | null {
    if (!data || typeof data !== 'object') {
        return 'NPE summary response is not an object.';
    }

    const summary = data as Partial<NpeSummary>;
    if (typeof summary.n_timesteps !== 'number' || !Number.isInteger(summary.n_timesteps) || summary.n_timesteps < 1) {
        return 'NPE summary is missing a valid timestep count.';
    }

    const columns = summary.timesteps as Record<string, unknown> | undefined;
    if (!columns || typeof columns !== 'object') {
        return 'NPE summary is missing timestep columns.';
    }

    for (const key of SUMMARY_COLUMNS) {
        const column = columns[key];
        if (!Array.isArray(column) || column.length !== summary.n_timesteps) {
            return `NPE summary column "${key}" is missing or length-mismatched (expected ${summary.n_timesteps}).`;
        }
    }

    return null;
}
