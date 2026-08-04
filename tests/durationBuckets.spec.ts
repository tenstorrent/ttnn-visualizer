// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { OpType } from '../src/definitions/Performance';
import { TypedPerfTableRow } from '../src/definitions/PerfTable';
import {
    buildLogDecadeBuckets,
    findBucketForDuration,
    hasBucketableDeviceTime,
    isDurationInSelectedBuckets,
} from '../src/functions/durationBuckets';

const row = (overrides: Partial<TypedPerfTableRow>): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        op_code: 'Matmul',
        raw_op_code: 'Matmul',
        device_time: 1,
        ...overrides,
    }) as TypedPerfTableRow;

const bucketsFor = (durations: number[]) =>
    buildLogDecadeBuckets(durations.map((duration) => row({ device_time: duration })));

describe('hasBucketableDeviceTime', () => {
    it('accepts device ops with a positive finite device time', () => {
        expect(hasBucketableDeviceTime(row({ device_time: 0.5 }))).toBe(true);
        expect(hasBucketableDeviceTime(row({ device_time: 12345 }))).toBe(true);
    });

    it('rejects signposts and non-positive or non-finite device times', () => {
        expect(hasBucketableDeviceTime(row({ op_type: OpType.SIGNPOST, device_time: 100 }))).toBe(false);
        expect(hasBucketableDeviceTime(row({ device_time: null }))).toBe(false);
        expect(hasBucketableDeviceTime(row({ device_time: 0 }))).toBe(false);
        expect(hasBucketableDeviceTime(row({ device_time: -5 }))).toBe(false);
        expect(hasBucketableDeviceTime(row({ device_time: Number.NaN }))).toBe(false);
        expect(hasBucketableDeviceTime(row({ device_time: Number.POSITIVE_INFINITY }))).toBe(false);
    });

    it('accepts rows with no raw op code, which only the histogram requires', () => {
        expect(hasBucketableDeviceTime(row({ raw_op_code: '', device_time: 5 }))).toBe(true);
    });
});

describe('buildLogDecadeBuckets', () => {
    it('filters unbucketable rows itself, so callers may pass raw table rows', () => {
        const buckets = buildLogDecadeBuckets([
            row({ op_type: OpType.SIGNPOST, device_time: 100000 }),
            row({ device_time: null }),
            row({ device_time: 0 }),
            row({ device_time: 5 }),
        ]);

        expect(buckets.map((bucket) => [bucket.minUs, bucket.maxUs])).toEqual([[1, 10]]);
    });

    it('returns no buckets when nothing is bucketable rather than degenerate decades', () => {
        expect(buildLogDecadeBuckets([])).toEqual([]);
        expect(buildLogDecadeBuckets([row({ device_time: null }), row({ device_time: -1 })])).toEqual([]);
    });

    it('spans every decade between the smallest and largest duration', () => {
        expect(bucketsFor([0.5, 5, 50]).map((bucket) => [bucket.minUs, bucket.maxUs])).toEqual([
            [0.1, 1],
            [1, 10],
            [10, 100],
        ]);
    });
});

describe('findBucketForDuration', () => {
    const buckets = bucketsFor([1, 1000]);

    it('treats bucket intervals as half-open, so a decade boundary starts a bucket', () => {
        expect(findBucketForDuration(1, buckets)?.minUs).toBe(1);
        expect(findBucketForDuration(9.99, buckets)?.minUs).toBe(1);
        expect(findBucketForDuration(10, buckets)?.minUs).toBe(10);
    });

    it('clamps a duration above the top bucket into the top bucket', () => {
        expect(findBucketForDuration(999999, buckets)?.minUs).toBe(1000);
    });

    it('returns null when there are no buckets', () => {
        expect(findBucketForDuration(5, [])).toBeNull();
    });
});

describe('isDurationInSelectedBuckets', () => {
    const buckets = bucketsFor([1, 1000]);

    it('matches a duration against the bucket it bins into', () => {
        expect(isDurationInSelectedBuckets(5, buckets, [1])).toBe(true);
        expect(isDurationInSelectedBuckets(5, buckets, [10])).toBe(false);
    });

    it('matches any of several selected buckets', () => {
        expect(isDurationInSelectedBuckets(5, buckets, [1, 100])).toBe(true);
        expect(isDurationInSelectedBuckets(500, buckets, [1, 100])).toBe(true);
        expect(isDurationInSelectedBuckets(50, buckets, [1, 100])).toBe(false);
    });

    it('agrees with the bin assignment at decade boundaries', () => {
        expect(isDurationInSelectedBuckets(10, buckets, [1])).toBe(false);
        expect(isDurationInSelectedBuckets(10, buckets, [10])).toBe(true);
    });

    it('excludes null, NaN and non-positive device times', () => {
        expect(isDurationInSelectedBuckets(null, buckets, [1])).toBe(false);
        expect(isDurationInSelectedBuckets(Number.NaN, buckets, [1])).toBe(false);
        expect(isDurationInSelectedBuckets(0, buckets, [1])).toBe(false);
        expect(isDurationInSelectedBuckets(-5, buckets, [1])).toBe(false);
    });

    it('matches nothing when no bucket is selected or no bucket exists', () => {
        expect(isDurationInSelectedBuckets(5, buckets, [])).toBe(false);
        expect(isDurationInSelectedBuckets(5, [], [1])).toBe(false);
    });
});
