// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { BoundType } from '../definitions/PerfTable';
import { TypedPerfTableRow } from '../model/PerfTable';

export function isSlowDramDominant(row: TypedPerfTableRow): boolean {
    return (
        row.bound === BoundType.SLOW &&
        row.dram_percent != null &&
        row.flops_percent != null &&
        row.dram_percent > row.flops_percent
    );
}
