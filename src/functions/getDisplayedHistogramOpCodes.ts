// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { DurationHistogramData, MAX_LEGEND_OP_CODES, OTHER_OP_CODE_LABEL } from '../definitions/PerfDurationHistogram';

export interface HistogramOpCodeStacks {
    displayedOpCodes: string[];
    rolledUpOpCodes: Set<string>;
}

/**
 * Returns stacked-trace labels ranked by total count across buckets.
 * When over `MAX_LEGEND_OP_CODES`, keeps the top N−1 and rolls the tail into Other.
 */
export function getHistogramOpCodeStacks(histogramData: DurationHistogramData): HistogramOpCodeStacks {
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
        return { displayedOpCodes: rankedOpCodes, rolledUpOpCodes: new Set<string>() };
    }

    return {
        displayedOpCodes: [...rankedOpCodes.slice(0, MAX_LEGEND_OP_CODES - 1), OTHER_OP_CODE_LABEL],
        rolledUpOpCodes: new Set(rankedOpCodes.slice(MAX_LEGEND_OP_CODES - 1)),
    };
}
