// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Shared log-decade binning for the op duration histogram and the perf table duration filter.
 * Both must agree on bucket edges, so neither may re-derive intervals of its own.
 *
 * The two bin different row sets — the histogram plots the active report, the table builds its
 * filter options from every dataset — so the histogram's rows must stay a subset of the table's.
 * Widen the histogram beyond the active report and a clicked bucket can name a decade the table
 * has no option for, which the stale-selection prune in PerfReport then discards on sight.
 *
 * The row sets also differ by filter, and deliberately: the histogram is fed the charts tab's
 * op-code selection, whereas clicking a bucket carries only the duration to the table. So a
 * column of a dozen ops can open a table of hundreds in that decade. Duration is kept a filter
 * in its own right because the two tabs own separate filter state, and copying the charts op-code
 * selection across would silently overwrite whatever the table already had selected.
 */
import { DurationBucket } from '../definitions/PerfDurationHistogram';
import { OpType } from '../definitions/Performance';
import { TypedPerfTableRow } from '../definitions/PerfTable';
import { formatDurationBucketRange } from './formatDurationBucketRange';

/** Log base for bucket edges: buckets span [10^n, 10^(n+1)), so each is ten times its lower bound. */
const DECADE_FACTOR = 10;

/** A row whose device time is known to be binnable, so callers need no cast to read it. */
export type BucketableRow = TypedPerfTableRow & { device_time: number };

const isBucketableDuration = (deviceTimeUs: number | null): deviceTimeUs is number =>
    deviceTimeUs !== null && Number.isFinite(deviceTimeUs) && deviceTimeUs > 0;

/** A row can be binned when it is a real device op with a positive, finite device time. */
export const hasBucketableDeviceTime = (row: TypedPerfTableRow): row is BucketableRow =>
    row.op_type !== OpType.SIGNPOST && isBucketableDuration(row.device_time);

/** Filters to bucketable rows itself, so callers may pass raw table rows. */
export const buildLogDecadeBuckets = (rows: TypedPerfTableRow[]): DurationBucket[] => {
    // Single pass: a report can hold hundreds of thousands of rows, and this reruns whenever the row set changes.
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (const row of rows) {
        if (hasBucketableDeviceTime(row)) {
            const duration = row.device_time;

            if (duration < min) {
                min = duration;
            }
            if (duration > max) {
                max = duration;
            }
        }
    }

    if (min === Number.POSITIVE_INFINITY) {
        return [];
    }

    // floor(log10(max)) so the top decade can contain max; ceil would leave an empty high bucket.
    const minExponent = Math.floor(Math.log10(min));
    const maxExponent = Math.floor(Math.log10(max));

    return Array.from({ length: maxExponent - minExponent + 1 }, (_, offset) => {
        const exponent = minExponent + offset;
        const minUs = DECADE_FACTOR ** exponent;
        const maxUs = DECADE_FACTOR ** (exponent + 1);

        return {
            bucketIndex: offset,
            minUs,
            maxUs,
            label: formatDurationBucketRange(minUs, maxUs),
        };
    });
};

export const findBucketForDuration = (deviceTimeUs: number, buckets: DurationBucket[]): DurationBucket | null => {
    if (buckets.length === 0) {
        return null;
    }

    // Indexed rather than `find`: this runs per row over hundreds of thousands of rows, and
    // `find` allocates a closure capturing the duration on every call.
    for (let index = 0; index < buckets.length; index++) {
        const bucket = buckets[index];

        if (deviceTimeUs >= bucket.minUs && deviceTimeUs < bucket.maxUs) {
            return bucket;
        }
    }

    return buckets[buckets.length - 1];
};

/**
 * The minUs of every bucket holding no bucketable row. Decades run contiguously between the
 * smallest and largest duration, so a middle decade can be empty even though the extremes are not,
 * and selecting one filters every row away with nothing on screen to explain why.
 */
export const getEmptyBucketMinUs = (
    rows: TypedPerfTableRow[],
    buckets: DurationBucket[],
): Set<DurationBucket['minUs']> => {
    const populatedMinUs = new Set<DurationBucket['minUs']>();

    for (const row of rows) {
        // Reports run to hundreds of thousands of rows and most have no empty decade at all
        if (populatedMinUs.size === buckets.length) {
            break;
        }

        if (hasBucketableDeviceTime(row)) {
            const bucket = findBucketForDuration(row.device_time, buckets);

            if (bucket) {
                populatedMinUs.add(bucket.minUs);
            }
        }
    }

    return new Set(buckets.filter((bucket) => !populatedMinUs.has(bucket.minUs)).map((bucket) => bucket.minUs));
};

/**
 * Matches a device time against selected buckets by resolving it through the same bin
 * assignment the histogram uses, rather than comparing against re-derived intervals.
 */
export const isDurationInSelectedBuckets = (
    deviceTimeUs: number | null,
    buckets: DurationBucket[],
    selectedMinUsSet: ReadonlySet<DurationBucket['minUs']>,
): boolean => {
    if (selectedMinUsSet.size === 0 || !isBucketableDuration(deviceTimeUs)) {
        return false;
    }

    const bucket = findBucketForDuration(deviceTimeUs, buckets);

    return bucket !== null && selectedMinUsSet.has(bucket.minUs);
};
