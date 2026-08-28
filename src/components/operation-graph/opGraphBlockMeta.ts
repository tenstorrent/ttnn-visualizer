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
export function formatBlockMeta(opCount: number, durationSeconds: number, memoryDeltaBytes: number): string {
    const parts = [`${opCount} ops`];
    if (durationSeconds > 0) {
        parts.push(`${formatSize(durationSeconds, 2)} s`);
    }
    if (memoryDeltaBytes !== 0) {
        const sign = memoryDeltaBytes > 0 ? '+' : '-';
        parts.push(`${sign}${formatMemorySize(Math.abs(memoryDeltaBytes), 0)}`);
    }
    return parts.join(' · ');
}
