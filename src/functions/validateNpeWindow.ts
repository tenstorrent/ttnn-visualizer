// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { NPE_LINK, NoCRoute, NoCTransfer, NpeWindow } from '../model/NPEModel';

// A link_demand row must carry at least [chip, y, x, noc_id, demand]; the 6th
// fabric-scope slot is optional.
const MIN_LINK_DEMAND_ROW_LENGTH = NPE_LINK.DEMAND + 1;

// Symmetric guard to validateNpeSummary (#861): the per-timestep window carries
// the heavy transfers + link_demand that NPEView indexes without null-checks
// (`npeData.timestep_data[t].active_transfers.forEach`, `noc_transfers.find`), so
// a partial / corrupt response would throw deep in a render memo rather than
// surface as a friendly error. Returns a human-readable error string, or null
// when the shape is sound. Enforced at the React Query fetch boundary.
export default function validateNpeWindow(data: unknown): string | null {
    if (!data || typeof data !== 'object') {
        return 'NPE window response is not an object.';
    }

    const window = data as Partial<NpeWindow>;
    if (typeof window.t !== 'number' || !Number.isInteger(window.t) || window.t < 0) {
        return 'NPE window is missing a valid timestep index.';
    }

    if (!Array.isArray(window.transfers)) {
        return 'NPE window is missing its transfers array.';
    }

    const timestep = window.timestep as Record<string, unknown> | undefined;
    if (!timestep || typeof timestep !== 'object') {
        return 'NPE window is missing timestep payload.';
    }

    if (!Array.isArray(timestep.active_transfers)) {
        return 'NPE window timestep is missing its active_transfers array.';
    }

    if (!Array.isArray(timestep.link_demand)) {
        return 'NPE window timestep is missing its link_demand array.';
    }

    // Per-row shape: NPEView indexes each row positionally and calls string
    // methods on NOC_ID, so a short row or non-string noc-id throws mid-render
    // rather than surfacing here as a friendly error.
    for (const row of timestep.link_demand) {
        if (!Array.isArray(row) || row.length < MIN_LINK_DEMAND_ROW_LENGTH) {
            return `NPE window link_demand row is malformed (expected at least ${MIN_LINK_DEMAND_ROW_LENGTH} entries).`;
        }
        if (typeof row[NPE_LINK.NOC_ID] !== 'string') {
            return 'NPE window link_demand row has a non-string NOC id.';
        }
        if (typeof row[NPE_LINK.DEMAND] !== 'number') {
            return 'NPE window link_demand row has a non-numeric demand.';
        }
    }

    // Transfers are resolved by id and their route walked without guards.
    for (const transfer of window.transfers as NoCTransfer[]) {
        if (!transfer || typeof transfer !== 'object') {
            return 'NPE window has a malformed transfer entry.';
        }
        if (typeof transfer.id !== 'number') {
            return 'NPE window transfer is missing a numeric id.';
        }
        if (!Array.isArray(transfer.route)) {
            return 'NPE window transfer is missing its route array.';
        }
        // NPEView/ActiveTransferDetails walk each route's links and read
        // injection_rate + src/dst without guards, so a malformed route entry
        // throws mid-render rather than surfacing here.
        for (const route of transfer.route as NoCRoute[]) {
            if (!route || typeof route !== 'object') {
                return 'NPE window transfer has a malformed route entry.';
            }
            if (!Array.isArray(route.links)) {
                return 'NPE window route entry is missing its links array.';
            }
            if (typeof route.injection_rate !== 'number') {
                return 'NPE window route entry has a non-numeric injection_rate.';
            }
            if (!Array.isArray(route.src) || !Array.isArray(route.dst)) {
                return 'NPE window route entry is missing src/dst coordinates.';
            }
        }
    }

    return null;
}
