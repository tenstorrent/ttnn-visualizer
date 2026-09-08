// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    DurationHistogramData,
    MAX_LEGEND_OP_CODES,
    OTHER_OP_CODE_LABEL,
} from '../src/definitions/PerfDurationHistogram';
import { getHistogramOpCodeStacks } from '../src/functions/getDisplayedHistogramOpCodes';

const histogramWithOpCodes = (opCodes: string[]): DurationHistogramData => ({
    buckets: [
        {
            bucket: { bucketIndex: 0, minUs: 1, maxUs: 10, label: '1µs – 10µs' },
            totalCount: opCodes.length,
            segmentsByOpCode: opCodes.map((rawOpCode, index) => ({
                rawOpCode,
                count: opCodes.length - index,
                sampleOps: [rawOpCode],
            })),
        },
    ],
});

describe('getHistogramOpCodeStacks', () => {
    it('returns all op codes when at or under the legend cap', () => {
        const { displayedOpCodes, rolledUpOpCodes } = getHistogramOpCodeStacks(histogramWithOpCodes(['A', 'B', 'C']));
        expect(displayedOpCodes).toEqual(['A', 'B', 'C']);
        expect(rolledUpOpCodes.size).toBe(0);
    });

    it('rolls the long tail into Other when over the legend cap', () => {
        const opCodes = Array.from({ length: MAX_LEGEND_OP_CODES + 3 }, (_, index) => `Op${index}`);
        const { displayedOpCodes, rolledUpOpCodes } = getHistogramOpCodeStacks(histogramWithOpCodes(opCodes));

        expect(displayedOpCodes).toHaveLength(MAX_LEGEND_OP_CODES);
        expect(displayedOpCodes[displayedOpCodes.length - 1]).toBe(OTHER_OP_CODE_LABEL);
        expect(displayedOpCodes.slice(0, -1)).toEqual(opCodes.slice(0, MAX_LEGEND_OP_CODES - 1));
        expect([...rolledUpOpCodes].sort()).toEqual(opCodes.slice(MAX_LEGEND_OP_CODES - 1).sort());
    });

    it('ranks by cross-bucket totals', () => {
        const histogram: DurationHistogramData = {
            buckets: [
                {
                    bucket: { bucketIndex: 0, minUs: 1, maxUs: 10, label: 'low' },
                    totalCount: 4,
                    segmentsByOpCode: [
                        { rawOpCode: 'Sparse', count: 1, sampleOps: ['s'] },
                        { rawOpCode: 'Dense', count: 3, sampleOps: ['d'] },
                    ],
                },
                {
                    bucket: { bucketIndex: 1, minUs: 10, maxUs: 100, label: 'high' },
                    totalCount: 5,
                    segmentsByOpCode: [
                        { rawOpCode: 'Sparse', count: 5, sampleOps: ['s'] },
                        { rawOpCode: 'Dense', count: 0, sampleOps: [] },
                    ],
                },
            ],
        };

        // Sparse: 1+5=6, Dense: 3+0=3
        expect(getHistogramOpCodeStacks(histogram).displayedOpCodes).toEqual(['Sparse', 'Dense']);
    });

    it('breaks total ties lexicographically', () => {
        const histogram: DurationHistogramData = {
            buckets: [
                {
                    bucket: { bucketIndex: 0, minUs: 1, maxUs: 10, label: 'tie' },
                    totalCount: 2,
                    segmentsByOpCode: [
                        { rawOpCode: 'Zebra', count: 1, sampleOps: ['z'] },
                        { rawOpCode: 'Alpha', count: 1, sampleOps: ['a'] },
                    ],
                },
            ],
        };

        expect(getHistogramOpCodeStacks(histogram).displayedOpCodes).toEqual(['Alpha', 'Zebra']);
    });
});
