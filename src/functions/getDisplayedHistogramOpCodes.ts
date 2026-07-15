// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { DurationHistogramData, MAX_LEGEND_OP_CODES, OTHER_OP_CODE_LABEL } from '../definitions/PerfDurationHistogram';

/**
 * Returns the op-code labels to render as stacked traces, ranked by total count.
 * When there are more than `MAX_LEGEND_OP_CODES` distinct codes, keeps the top
 * `MAX_LEGEND_OP_CODES - 1` and appends `Other` for the tail.
 */
export function getDisplayedHistogramOpCodes(histogramData: DurationHistogramData): string[] {
    const totalByOpCode = new Map<string, number>();

    histogramData.buckets.forEach((bucket) => {
        bucket.segmentsByOpCode.forEach((segment) => {
            totalByOpCode.set(segment.rawOpCode, (totalByOpCode.get(segment.rawOpCode) ?? 0) + segment.count);
        });
    });

    const rankedOpCodes = [...totalByOpCode.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([rawOpCode]) => rawOpCode);

    if (rankedOpCodes.length <= MAX_LEGEND_OP_CODES) {
        return rankedOpCodes;
    }

    return [...rankedOpCodes.slice(0, MAX_LEGEND_OP_CODES - 1), OTHER_OP_CODE_LABEL];
}

export function getRolledUpHistogramOpCodes(
    histogramData: DurationHistogramData,
    displayedOpCodes: string[],
): Set<string> {
    if (!displayedOpCodes.includes(OTHER_OP_CODE_LABEL)) {
        return new Set();
    }

    const namedOpCodes = new Set(displayedOpCodes.filter((opCode) => opCode !== OTHER_OP_CODE_LABEL));
    const rolledUp = new Set<string>();

    histogramData.buckets.forEach((bucket) => {
        bucket.segmentsByOpCode.forEach((segment) => {
            if (!namedOpCodes.has(segment.rawOpCode)) {
                rolledUp.add(segment.rawOpCode);
            }
        });
    });

    return rolledUp;
}
