// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { OpType } from '../src/definitions/Performance';
import { TypedPerfTableRow } from '../src/definitions/PerfTable';
import {
    buildLogDecadeBuckets,
    findBucketForDuration,
    getEmptyBucketMinUs,
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

const selected = (...minUsValues: number[]) => new Set(minUsValues);

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
        expect(isDurationInSelectedBuckets(5, buckets, selected(1))).toBe(true);
        expect(isDurationInSelectedBuckets(5, buckets, selected(10))).toBe(false);
    });

    it('matches any of several selected buckets', () => {
        expect(isDurationInSelectedBuckets(5, buckets, selected(1, 100))).toBe(true);
        expect(isDurationInSelectedBuckets(500, buckets, selected(1, 100))).toBe(true);
        expect(isDurationInSelectedBuckets(50, buckets, selected(1, 100))).toBe(false);
    });

    it('agrees with the bin assignment at decade boundaries', () => {
        expect(isDurationInSelectedBuckets(10, buckets, selected(1))).toBe(false);
        expect(isDurationInSelectedBuckets(10, buckets, selected(10))).toBe(true);
    });

    it('excludes null, NaN and non-positive device times', () => {
        expect(isDurationInSelectedBuckets(null, buckets, selected(1))).toBe(false);
        expect(isDurationInSelectedBuckets(Number.NaN, buckets, selected(1))).toBe(false);
        expect(isDurationInSelectedBuckets(0, buckets, selected(1))).toBe(false);
        expect(isDurationInSelectedBuckets(-5, buckets, selected(1))).toBe(false);
    });

    it('matches nothing when no bucket is selected or no bucket exists', () => {
        expect(isDurationInSelectedBuckets(5, buckets, selected())).toBe(false);
        expect(isDurationInSelectedBuckets(5, [], selected(1))).toBe(false);
    });
});

describe('getEmptyBucketMinUs', () => {
    const rowsFor = (durations: number[]) => durations.map((duration) => row({ device_time: duration }));

    it('names the decades between the extremes that hold no row', () => {
        const durations = [5, 5000];
        const empty = getEmptyBucketMinUs(rowsFor(durations), bucketsFor(durations));

        expect([...empty].sort((a, b) => a - b)).toEqual([10, 100]);
    });

    it('names nothing when every decade is populated', () => {
        const durations = [5, 50, 500];

        expect(getEmptyBucketMinUs(rowsFor(durations), bucketsFor(durations)).size).toBe(0);
    });

    it('ignores rows the buckets were never built from, so unbucketable rows fill no decade', () => {
        const buckets = bucketsFor([5, 5000]);
        const rows = [
            ...rowsFor([5, 5000]),
            row({ device_time: 50, op_type: OpType.SIGNPOST }),
            row({ device_time: 5 }),
        ];

        expect([...getEmptyBucketMinUs(rows, buckets)].sort((a, b) => a - b)).toEqual([10, 100]);
    });

    it('names nothing when there are no buckets', () => {
        expect(getEmptyBucketMinUs(rowsFor([5]), []).size).toBe(0);
    });

    it('names every bucket when no row is bucketable', () => {
        const buckets = bucketsFor([5, 50]);

        expect([...getEmptyBucketMinUs([row({ device_time: null })], buckets)].sort((a, b) => a - b)).toEqual([1, 10]);
    });
});

describe('histogram and table bucket agreement', () => {
    // The histogram bins the active report while the table builds its filter options from every
    // dataset, so a bucket the user can click must always exist among the table's options.
    it('keeps a subset row set within the decades of the superset it is drawn from', () => {
        const activeReportDurations = [5, 50];
        const everyDatasetDurations = [...activeReportDurations, 0.5, 5000];

        const optionMinUsValues = new Set(bucketsFor(everyDatasetDurations).map((bucket) => bucket.minUs));
        const clickableMinUsValues = bucketsFor(activeReportDurations).map((bucket) => bucket.minUs);

        expect(clickableMinUsValues.length).toBeGreaterThan(0);
        expect(clickableMinUsValues.every((minUs) => optionMinUsValues.has(minUs))).toBe(true);
    });
});
