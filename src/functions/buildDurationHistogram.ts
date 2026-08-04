// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
    DurationHistogramBucket,
    DurationHistogramData,
    SAMPLE_OPS_PER_BUCKET,
} from '../definitions/PerfDurationHistogram';
import { TypedPerfTableRow } from '../definitions/PerfTable';
import { buildLogDecadeBuckets, findBucketForDuration, hasBucketableDeviceTime } from './durationBuckets';

const hasChartRawOpCode = (row: TypedPerfTableRow): boolean => {
    const { raw_op_code: rawOpCode } = row;
    return rawOpCode != null && rawOpCode !== '';
};

/** Stacking by op code needs a raw op code on top of what plain binning requires. */
const isEligibleHistogramRow = (row: TypedPerfTableRow): boolean =>
    hasBucketableDeviceTime(row) && hasChartRawOpCode(row);

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

        if (!bucket) {
            return;
        }

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
