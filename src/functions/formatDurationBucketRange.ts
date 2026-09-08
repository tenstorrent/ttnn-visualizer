// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { formatDuration } from './formatting';

const MICROSECONDS_TO_NANOSECONDS = 1_000;

/**
 * Formats a half-open duration bucket [minUs, maxUs) for axis labels and hovers.
 * `formatDuration` expects nanoseconds; perf rows store device time in microseconds.
 */
export function formatDurationBucketRange(minUs: number, maxUs: number): string {
    if (minUs <= 0) {
        return `< ${formatDuration(maxUs * MICROSECONDS_TO_NANOSECONDS)}`;
    }

    const minNs = minUs * MICROSECONDS_TO_NANOSECONDS;
    const maxNs = maxUs * MICROSECONDS_TO_NANOSECONDS;

    return `${formatDuration(minNs)} – ${formatDuration(maxNs)}`;
}
