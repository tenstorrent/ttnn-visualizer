// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    DurationHistogramData,
    MAX_LEGEND_OP_CODES,
    OTHER_OP_CODE_LABEL,
} from '../src/definitions/PerfDurationHistogram';
import {
    getDisplayedHistogramOpCodes,
    getRolledUpHistogramOpCodes,
} from '../src/functions/getDisplayedHistogramOpCodes';

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

describe('getDisplayedHistogramOpCodes', () => {
    it('returns all op codes when at or under the legend cap', () => {
        const histogram = histogramWithOpCodes(['A', 'B', 'C']);
        expect(getDisplayedHistogramOpCodes(histogram)).toEqual(['A', 'B', 'C']);
    });

    it('rolls the long tail into Other when over the legend cap', () => {
        const opCodes = Array.from({ length: MAX_LEGEND_OP_CODES + 3 }, (_, index) => `Op${index}`);
        const displayed = getDisplayedHistogramOpCodes(histogramWithOpCodes(opCodes));

        expect(displayed).toHaveLength(MAX_LEGEND_OP_CODES);
        expect(displayed[displayed.length - 1]).toBe(OTHER_OP_CODE_LABEL);
        expect(displayed.slice(0, -1)).toEqual(opCodes.slice(0, MAX_LEGEND_OP_CODES - 1));

        const rolledUp = getRolledUpHistogramOpCodes(histogramWithOpCodes(opCodes), displayed);
        expect([...rolledUp].sort()).toEqual(opCodes.slice(MAX_LEGEND_OP_CODES - 1).sort());
    });
});
