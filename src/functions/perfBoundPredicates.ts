// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { BoundType } from '../definitions/PerfTable';
import { HIGH_DISPATCH_THRESHOLD_US } from '../definitions/Performance';
import { TypedPerfTableRow } from '../model/PerfTable';

export function isSlowDramDominant(row: TypedPerfTableRow): boolean {
    return (
        row.bound === BoundType.SLOW &&
        row.dram_percent != null &&
        row.flops_percent != null &&
        row.dram_percent > row.flops_percent
    );
}

// The one high-dispatch rule: the row flag, the Slow column, the tracing banner and the red
// Op-to-Op Gap cell all derive from it, so they cannot disagree about which ops it marks.
export function isHighDispatchGap(opToOpGap: number | null): boolean {
    return opToOpGap !== null && opToOpGap > HIGH_DISPATCH_THRESHOLD_US;
}
