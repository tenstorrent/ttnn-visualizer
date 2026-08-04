// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Shared log-decade binning for the op duration histogram and the perf table duration filter.
 * Both must agree on bucket edges, so neither may re-derive intervals of its own.
 */
import { DurationBucket } from '../definitions/PerfDurationHistogram';
import { OpType } from '../definitions/Performance';
import { TypedPerfTableRow } from '../definitions/PerfTable';
import { formatDurationBucketRange } from './formatDurationBucketRange';

/** Log base for bucket edges: buckets span [10^n, 10^(n+1)), so each is ten times its lower bound. */
export const DECADE_FACTOR = 10;

/** A row can be binned when it is a real device op with a positive, finite device time. */
export const hasBucketableDeviceTime = (row: TypedPerfTableRow): boolean =>
    row.op_type !== OpType.SIGNPOST &&
    row.device_time !== null &&
    Number.isFinite(row.device_time) &&
    (row.device_time as number) > 0;

const getMinMaxDuration = (durations: number[]): { min: number; max: number } => {
    let min = durations[0];
    let max = durations[0];

    for (let index = 1; index < durations.length; index++) {
        const duration = durations[index];
        if (duration < min) {
            min = duration;
        }
        if (duration > max) {
            max = duration;
        }
    }

    return { min, max };
};

/** Filters to bucketable rows itself, so callers may pass raw table rows. */
export const buildLogDecadeBuckets = (rows: TypedPerfTableRow[]): DurationBucket[] => {
    const positiveDurations = rows.filter(hasBucketableDeviceTime).map((row) => row.device_time as number);

    if (positiveDurations.length === 0) {
        return [];
    }

    const { min, max } = getMinMaxDuration(positiveDurations);

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

    const matchedBucket = buckets.find((bucket) => deviceTimeUs >= bucket.minUs && deviceTimeUs < bucket.maxUs);

    return matchedBucket ?? buckets[buckets.length - 1];
};

/**
 * Matches a device time against selected buckets by resolving it through the same bin
 * assignment the histogram uses, rather than comparing against re-derived intervals.
 */
export const isDurationInSelectedBuckets = (
    deviceTimeUs: number | null,
    buckets: DurationBucket[],
    selectedMinUsList: DurationBucket['minUs'][],
): boolean => {
    if (
        selectedMinUsList.length === 0 ||
        deviceTimeUs === null ||
        !Number.isFinite(deviceTimeUs) ||
        deviceTimeUs <= 0
    ) {
        return false;
    }

    const bucket = findBucketForDuration(deviceTimeUs, buckets);

    return bucket !== null && selectedMinUsList.includes(bucket.minUs);
};
