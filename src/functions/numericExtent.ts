// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { NumberRange } from '@blueprintjs/core';
import { PerfTableRow } from '../model/PerfTable';

/**
 * @description The largest of `values`, for data-sized input. `Math.max(...values)` passes
 * every element as a call argument, and the engine throws `RangeError` once there are more
 * than it allows — around 120k elements in V8, well within a large performance report.
 *
 * Folding with `Math.max` itself (rather than `value > result`) keeps the spread's exact
 * semantics: an empty input is `-Infinity`, any `NaN` makes the result `NaN`, and `null`
 * coerces to 0.
 */
export const getMaxValue = (values: Iterable<number>): number => {
    let result = -Infinity;

    for (const value of values) {
        result = Math.max(result, value);
    }

    return result;
};

/**
 * @description The span of performance row ids in `report`, in one pass, or `null` for an
 * empty or missing report. The footer's range slider reads it on every route, so a throw
 * here takes the footer, and with it the range selection, down on every route.
 */
export const getPerformanceIdRange = (report: PerfTableRow[] | undefined): NumberRange | null => {
    if (!report?.length) {
        return null;
    }

    let min = Infinity;
    let max = -Infinity;

    for (const row of report) {
        const id = parseInt(row.id, 10);

        min = Math.min(min, id);
        max = Math.max(max, id);
    }

    return [min, max];
};
