// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { NPEData } from '../../src/model/NPEModel';

/** Minimal well-formed whole-file NPE payload for parse / validate / route specs. */
export const minimalValidNpeData = {
    common_info: { version: '1.0.0' },
    noc_transfers: [{ id: 0 }],
    timestep_data: [{ active_transfers: [] }],
} as unknown as NPEData;
