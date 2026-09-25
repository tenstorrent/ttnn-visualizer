// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { formatMemorySize, formatSize } from '../../functions/math';

/**
 * @description The block node's second line — op count, then duration and memory
 * delta when there is any to report. Shared by the node and the block panel, which
 * are on screen together: two derivations of the same numbers would show up as the
 * two of them disagreeing about one block. #1944
 */
export function formatBlockMeta(
    opCount: number,
    durationSeconds: number,
    memoryDeltaBytes: number,
    weightLoadCount = 0,
): string {
    // Folding a grouping block absorbs the weight loads inside it, so `Collapse
    // weight loads` has nothing left to draw and the reader is left asking where
    // they went. Saying how many are in here answers that at the point the
    // question occurs, without moving the operations or changing what the block
    // reports. Across the local captures weight loads are 41-46% of a graph by
    // node count but 9-23% of its time, so the split is worth seeing rather than
    // assuming. #2028
    const parts = [weightLoadCount > 0 ? `${opCount} ops (${weightLoadCount} weight)` : `${opCount} ops`];
    if (durationSeconds > 0) {
        parts.push(`${formatSize(durationSeconds, 2)} s`);
    }
    if (memoryDeltaBytes !== 0) {
        const sign = memoryDeltaBytes > 0 ? '+' : '-';
        parts.push(`${sign}${formatMemorySize(Math.abs(memoryDeltaBytes), 0)}`);
    }
    return parts.join(' · ');
}
