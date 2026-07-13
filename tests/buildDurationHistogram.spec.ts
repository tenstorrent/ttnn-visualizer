// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import buildDurationHistogram from '../src/functions/buildDurationHistogram';
import { OpType } from '../src/definitions/Performance';
import { TypedPerfTableRow } from '../src/definitions/PerfTable';

const row = (overrides: Partial<TypedPerfTableRow>): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        op_code: 'Matmul',
        raw_op_code: 'Matmul',
        device_time: 1,
        ...overrides,
    }) as TypedPerfTableRow;

describe('buildDurationHistogram', () => {
    it('excludes signposts and null device_time rows', () => {
        const histogram = buildDurationHistogram([
            row({ op_type: OpType.SIGNPOST, device_time: 100 }),
            row({ device_time: null }),
            row({ device_time: 5, raw_op_code: 'Matmul' }),
        ]);

        expect(histogram.buckets.reduce((sum, bucket) => sum + bucket.totalCount, 0)).toBe(1);
    });

    it('bins positive durations into log-decade buckets', () => {
        const histogram = buildDurationHistogram([
            row({ device_time: 0.5, raw_op_code: 'A' }),
            row({ device_time: 5, raw_op_code: 'B' }),
            row({ device_time: 50, raw_op_code: 'C' }),
        ]);

        expect(histogram.buckets.length).toBeGreaterThanOrEqual(2);
        expect(histogram.buckets.reduce((sum, bucket) => sum + bucket.totalCount, 0)).toBe(3);
    });

    it('places non-positive durations in the lowest bucket', () => {
        const histogram = buildDurationHistogram([row({ device_time: 0, raw_op_code: 'Zero' })]);

        expect(histogram.buckets[0]?.totalCount).toBe(1);
        expect(histogram.buckets[0]?.bucket.minUs).toBe(0);
    });

    it('returns sample ops sorted by duration within a bucket', () => {
        const histogram = buildDurationHistogram([
            row({ device_time: 2, op_code: 'slow-matmul', raw_op_code: 'Matmul' }),
            row({ device_time: 1, op_code: 'fast-matmul', raw_op_code: 'Matmul' }),
        ]);

        const matmulSegment = histogram.buckets
            .flatMap((bucket) => bucket.segmentsByOpCode)
            .find((segment) => segment.rawOpCode === 'Matmul');

        expect(matmulSegment?.sampleOps[0]).toBe('slow-matmul');
    });
});
