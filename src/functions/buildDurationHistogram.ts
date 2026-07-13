// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
    DurationBucket,
    DurationHistogramBucket,
    DurationHistogramData,
    SAMPLE_OPS_PER_BUCKET,
} from '../definitions/PerfDurationHistogram';
import { OpType } from '../definitions/Performance';
import { TypedPerfTableRow } from '../definitions/PerfTable';
import { formatDurationBucketRange } from './formatDurationBucketRange';

const isEligibleHistogramRow = (row: TypedPerfTableRow): boolean =>
    row.op_type !== OpType.SIGNPOST && row.device_time !== null && row.device_time !== undefined;

const buildLogDecadeBuckets = (rows: TypedPerfTableRow[]): DurationBucket[] => {
    const positiveDurations = rows
        .map((row) => row.device_time)
        .filter((duration): duration is number => duration !== null && duration !== undefined && duration > 0);

    const hasNonPositive = rows.some((row) => (row.device_time ?? 0) <= 0);

    if (positiveDurations.length === 0) {
        return [
            {
                bucketIndex: 0,
                minUs: 0,
                maxUs: 1,
                label: formatDurationBucketRange(0, 1),
            },
        ];
    }

    const minExponent = Math.floor(Math.log10(Math.min(...positiveDurations)));
    const maxExponent = Math.ceil(Math.log10(Math.max(...positiveDurations)));

    return Array.from({ length: maxExponent - minExponent + 1 }, (_, offset) => {
        const exponent = minExponent + offset;
        const minUs = exponent === minExponent && hasNonPositive ? 0 : 10 ** exponent;
        const maxUs = 10 ** (exponent + 1);

        return {
            bucketIndex: offset,
            minUs,
            maxUs,
            label: formatDurationBucketRange(minUs, maxUs),
        };
    });
};

const findBucketForDuration = (deviceTimeUs: number, buckets: DurationBucket[]): DurationBucket => {
    const matchedBucket = buckets.find((bucket) => deviceTimeUs >= bucket.minUs && deviceTimeUs < bucket.maxUs);

    return matchedBucket ?? buckets[buckets.length - 1];
};

function buildDurationHistogram(rows: TypedPerfTableRow[]): DurationHistogramData {
    const eligibleRows = rows.filter(isEligibleHistogramRow);

    if (eligibleRows.length === 0) {
        return { buckets: [] };
    }

    const buckets = buildLogDecadeBuckets(eligibleRows);
    const rowsByBucketIndex = new Map<number, TypedPerfTableRow[]>();

    eligibleRows.forEach((row) => {
        const bucket = findBucketForDuration(row.device_time ?? 0, buckets);
        const bucketRows = rowsByBucketIndex.get(bucket.bucketIndex) ?? [];
        bucketRows.push(row);
        rowsByBucketIndex.set(bucket.bucketIndex, bucketRows);
    });

    const histogramBuckets: DurationHistogramBucket[] = buckets.map((bucket) => {
        const bucketRows = rowsByBucketIndex.get(bucket.bucketIndex) ?? [];
        const countByOpCode = new Map<string, TypedPerfTableRow[]>();

        bucketRows.forEach((row) => {
            const opCode = row.raw_op_code ?? 'unknown';
            const opRows = countByOpCode.get(opCode) ?? [];
            opRows.push(row);
            countByOpCode.set(opCode, opRows);
        });

        const segmentsByOpCode = [...countByOpCode.entries()].map(([rawOpCode, opRows]) => ({
            rawOpCode,
            count: opRows.length,
            sampleOps: [...opRows]
                .sort((left, right) => (right.device_time ?? 0) - (left.device_time ?? 0))
                .slice(0, SAMPLE_OPS_PER_BUCKET)
                .map((row) => row.op_code),
        }));

        return {
            bucket,
            totalCount: bucketRows.length,
            segmentsByOpCode,
        };
    });

    return { buckets: histogramBuckets };
}

export default buildDurationHistogram;
