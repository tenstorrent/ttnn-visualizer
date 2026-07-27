// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { NpeWindow } from '../model/NPEModel';

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

    return null;
}
