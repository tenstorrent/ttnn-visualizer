// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { formatDuration } from './formatting';
import { NS_PER_US } from './math';

/**
 * Formats a half-open duration bucket [minUs, maxUs) for axis labels and hovers.
 * `formatDuration` expects nanoseconds; perf rows store device time in microseconds.
 */
export function formatDurationBucketRange(minUs: number, maxUs: number): string {
    if (minUs <= 0) {
        return `< ${formatDuration(maxUs * NS_PER_US)}`;
    }

    const minNs = minUs * NS_PER_US;
    const maxNs = maxUs * NS_PER_US;

    return `${formatDuration(minNs)} – ${formatDuration(maxNs)}`;
}
