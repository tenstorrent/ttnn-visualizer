// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import buildDurationHistogram from '../src/functions/buildDurationHistogram';
import { SAMPLE_OPS_PER_BUCKET } from '../src/definitions/PerfDurationHistogram';
import { OpType } from '../src/definitions/Performance';
import { TypedPerfTableRow } from '../src/model/PerfTable';

const row = (overrides: Partial<TypedPerfTableRow>): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        op_code: 'Matmul',
        raw_op_code: 'Matmul',
        device_time: 1,
        ...overrides,
    }) as TypedPerfTableRow;

describe('buildDurationHistogram', () => {
    it('returns empty buckets for empty or all-ineligible input', () => {
        expect(buildDurationHistogram([]).buckets).toEqual([]);
        expect(
            buildDurationHistogram([
                row({ op_type: OpType.SIGNPOST, device_time: 100 }),
                row({ device_time: null }),
                row({ device_time: 0 }),
                row({ device_time: -5 }),
                row({ device_time: Number.NaN }),
                row({ device_time: Number.POSITIVE_INFINITY }),
                row({ raw_op_code: null as unknown as string, device_time: 5 }),
                row({ raw_op_code: '', device_time: 5 }),
            ]).buckets,
        ).toEqual([]);
    });

    it('excludes signposts, non-positive device_time, and null/empty raw_op_code rows', () => {
        const histogram = buildDurationHistogram([
            row({ op_type: OpType.SIGNPOST, device_time: 100 }),
            row({ device_time: null }),
            row({ device_time: 0 }),
            row({ device_time: -5 }),
            row({ raw_op_code: null as unknown as string, device_time: 8 }),
            row({ raw_op_code: '', device_time: 9 }),
            row({ device_time: 5, raw_op_code: 'Matmul' }),
        ]);

        expect(histogram.buckets.reduce((sum, bucket) => sum + bucket.totalCount, 0)).toBe(1);
        expect(histogram.buckets.flatMap((bucket) => bucket.segmentsByOpCode).map((s) => s.rawOpCode)).toEqual([
            'Matmul',
        ]);
    });

    it('bins positive durations into log-decade buckets without a spurious empty high bucket', () => {
        const histogram = buildDurationHistogram([
            row({ device_time: 0.5, raw_op_code: 'A' }),
            row({ device_time: 5, raw_op_code: 'B' }),
            row({ device_time: 50, raw_op_code: 'C' }),
        ]);

        expect(histogram.buckets.map((entry) => [entry.bucket.minUs, entry.bucket.maxUs])).toEqual([
            [0.1, 1],
            [1, 10],
            [10, 100],
        ]);
        expect(histogram.buckets.reduce((sum, bucket) => sum + bucket.totalCount, 0)).toBe(3);
        expect(histogram.buckets.every((bucket) => bucket.totalCount > 0)).toBe(true);
    });

    it('places exact decade boundaries in the half-open bucket that starts at that value', () => {
        const histogram = buildDurationHistogram([
            row({ device_time: 1, raw_op_code: 'A' }),
            row({ device_time: 10, raw_op_code: 'B' }),
            row({ device_time: 100, raw_op_code: 'C' }),
        ]);

        expect(histogram.buckets.map((entry) => [entry.bucket.minUs, entry.bucket.maxUs, entry.totalCount])).toEqual([
            [1, 10, 1],
            [10, 100, 1],
            [100, 1000, 1],
        ]);
    });

    it('returns sample ops sorted by duration and capped at SAMPLE_OPS_PER_BUCKET', () => {
        const histogram = buildDurationHistogram([
            row({ device_time: 6, op_code: 'op-6', raw_op_code: 'Matmul' }),
            row({ device_time: 5, op_code: 'op-5', raw_op_code: 'Matmul' }),
            row({ device_time: 4, op_code: 'op-4', raw_op_code: 'Matmul' }),
            row({ device_time: 3, op_code: 'op-3', raw_op_code: 'Matmul' }),
            row({ device_time: 2, op_code: 'op-2', raw_op_code: 'Matmul' }),
            row({ device_time: 1, op_code: 'op-1', raw_op_code: 'Matmul' }),
        ]);

        const matmulSegment = histogram.buckets
            .flatMap((bucket) => bucket.segmentsByOpCode)
            .find((segment) => segment.rawOpCode === 'Matmul');

        expect(matmulSegment?.sampleOps).toEqual(['op-6', 'op-5', 'op-4', 'op-3', 'op-2']);
        expect(matmulSegment?.sampleOps).toHaveLength(SAMPLE_OPS_PER_BUCKET);
    });

    it('segments counts by raw op code within a bucket', () => {
        const histogram = buildDurationHistogram([
            row({ device_time: 2, raw_op_code: 'Matmul' }),
            row({ device_time: 3, raw_op_code: 'Matmul' }),
            row({ device_time: 4, raw_op_code: 'Conv2d' }),
        ]);

        const bucket = histogram.buckets.find((entry) => entry.bucket.minUs === 1);
        expect(bucket?.totalCount).toBe(3);
        expect(bucket?.segmentsByOpCode).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ rawOpCode: 'Matmul', count: 2 }),
                expect.objectContaining({ rawOpCode: 'Conv2d', count: 1 }),
            ]),
        );
    });
});
