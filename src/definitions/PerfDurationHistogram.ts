// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export interface DurationBucket {
    bucketIndex: number;
    minUs: number;
    maxUs: number;
    label: string;
}

export interface DurationHistogramBucketSegment {
    rawOpCode: string;
    count: number;
    sampleOps: string[];
}

export interface DurationHistogramBucket {
    bucket: DurationBucket;
    totalCount: number;
    segmentsByOpCode: DurationHistogramBucketSegment[];
}

export interface DurationHistogramData {
    buckets: DurationHistogramBucket[];
}

export const SAMPLE_OPS_PER_BUCKET = 5;

/** Max distinct stacked traces (including the rolled-up Other segment when used). */
export const MAX_LEGEND_OP_CODES = 12;

export const OTHER_OP_CODE_LABEL = 'Other';

/** Neutral grey from `MarkerColours` — reserved for the rolled-up tail segment. */
export const OTHER_OP_CODE_COLOUR = 'rgb(199, 199, 199)';
