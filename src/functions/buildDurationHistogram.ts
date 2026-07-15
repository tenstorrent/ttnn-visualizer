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

const hasChartRawOpCode = (row: TypedPerfTableRow): boolean => {
    const { raw_op_code: rawOpCode } = row;
    return rawOpCode != null && rawOpCode !== '';
};

const isEligibleHistogramRow = (row: TypedPerfTableRow): boolean =>
    row.op_type !== OpType.SIGNPOST &&
    row.device_time !== null &&
    Number.isFinite(row.device_time) &&
    (row.device_time as number) > 0 &&
    hasChartRawOpCode(row);

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

const buildLogDecadeBuckets = (rows: TypedPerfTableRow[]): DurationBucket[] => {
    const positiveDurations = rows.map((row) => row.device_time as number);
    const { min, max } = getMinMaxDuration(positiveDurations);

    // floor(log10(max)) so the top decade can contain max; ceil would leave an empty high bucket.
    const minExponent = Math.floor(Math.log10(min));
    const maxExponent = Math.floor(Math.log10(max));

    return Array.from({ length: maxExponent - minExponent + 1 }, (_, offset) => {
        const exponent = minExponent + offset;
        const minUs = 10 ** exponent;
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

interface SampleCandidate {
    opCode: string;
    deviceTime: number;
}

/** Keep at most SAMPLE_OPS_PER_BUCKET samples, ordered by descending device time. */
const insertTopSampleByDuration = (samples: SampleCandidate[], candidate: SampleCandidate): void => {
    if (samples.length === SAMPLE_OPS_PER_BUCKET && candidate.deviceTime <= samples[samples.length - 1].deviceTime) {
        return;
    }

    let insertAt = samples.findIndex((sample) => candidate.deviceTime > sample.deviceTime);
    if (insertAt === -1) {
        insertAt = samples.length;
    }

    samples.splice(insertAt, 0, candidate);

    if (samples.length > SAMPLE_OPS_PER_BUCKET) {
        samples.length = SAMPLE_OPS_PER_BUCKET;
    }
};

interface SegmentAggregate {
    count: number;
    topSamples: SampleCandidate[];
}

function buildDurationHistogram(rows: TypedPerfTableRow[]): DurationHistogramData {
    const eligibleRows = rows.filter(isEligibleHistogramRow);

    if (eligibleRows.length === 0) {
        return { buckets: [] };
    }

    const buckets = buildLogDecadeBuckets(eligibleRows);
    const rowsByBucketIndex = new Map<number, TypedPerfTableRow[]>();

    eligibleRows.forEach((row) => {
        const bucket = findBucketForDuration(row.device_time as number, buckets);
        const bucketRows = rowsByBucketIndex.get(bucket.bucketIndex) ?? [];
        bucketRows.push(row);
        rowsByBucketIndex.set(bucket.bucketIndex, bucketRows);
    });

    const histogramBuckets: DurationHistogramBucket[] = buckets.map((bucket) => {
        const bucketRows = rowsByBucketIndex.get(bucket.bucketIndex) ?? [];
        const aggregateByOpCode = new Map<string, SegmentAggregate>();

        bucketRows.forEach((row) => {
            const rawOpCode = row.raw_op_code;
            const aggregate = aggregateByOpCode.get(rawOpCode) ?? { count: 0, topSamples: [] };
            aggregate.count += 1;
            insertTopSampleByDuration(aggregate.topSamples, {
                opCode: row.op_code,
                deviceTime: row.device_time as number,
            });
            aggregateByOpCode.set(rawOpCode, aggregate);
        });

        const segmentsByOpCode = [...aggregateByOpCode.entries()].map(([rawOpCode, aggregate]) => ({
            rawOpCode,
            count: aggregate.count,
            sampleOps: aggregate.topSamples.map((sample) => sample.opCode),
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
