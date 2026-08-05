// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { MarkerColours } from './PerfTable';

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

/** Neutral grey from the shared marker palette — reserved for the rolled-up tail segment. */
export const OTHER_OP_CODE_COLOUR = MarkerColours[18];

export const EMPTY_SAMPLES_SUMMARY = '—';

export const PERF_DURATION_HISTOGRAM_ARIA_LABEL = 'Op duration distribution';

export const PERF_DURATION_HISTOGRAM_EMPTY_MESSAGE = 'No device ops available for duration histogram.';

export const PERF_DURATION_HISTOGRAM_ACTIVE_REPORT_SUBTITLE = 'Active report only';

export const PERF_DURATION_BUCKET_FILTER_HINT =
    'Click a duration range below the chart to filter the table by op duration';

/** Drops the bucket controls just below the axis line, into the space the tick labels vacate. */
export const PERF_DURATION_BUCKET_ANNOTATION_Y_SHIFT = -8;

/** Pushes the axis title clear of the bucket controls drawn between it and the axis. */
export const PERF_DURATION_BUCKET_AXIS_TITLE_STANDOFF = 34;

export const PERF_DURATION_BUCKET_ANNOTATION_FONT_SIZE = 11;
