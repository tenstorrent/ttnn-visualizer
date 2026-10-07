// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { OperationCategories } from '../definitions/StackedPerfTable';
import { TypedPerfTableRow } from '../model/PerfTable';

// Host is left out: tt-perf-report blanks Device Time for host ops, so its share of device time
// would always read 0% and suggest host ops cost nothing.
export const DEVICE_TIME_CATEGORIES = [
    OperationCategories.COMPUTE,
    OperationCategories.CCL,
    OperationCategories.DM,
    OperationCategories.TM,
    OperationCategories.OTHER,
] as const;

export type DeviceTimeCategory = (typeof DEVICE_TIME_CATEGORIES)[number];

export const MAX_LISTED_OTHER_OPS = 10;

export interface OpCategoryBreakdown {
    percentByCategory: Record<DeviceTimeCategory, number>;
    /**
     * Device time in rows whose category tt-perf-report did not report or this app does not know.
     * Kept apart from Other so a category added upstream is never silently counted as unexplained.
     */
    unclassifiedPercent: number;
    /** The largest Other ops by device time, at most MAX_LISTED_OTHER_OPS of them. */
    largestOtherOps: TypedPerfTableRow[];
    otherOpCount: number;
    hasHostOps: boolean;
}

/**
 * Keeps `largest` ordered by device time, descending, and no longer than MAX_LISTED_OTHER_OPS, so a
 * report with hundreds of thousands of Other rows never builds or sorts a full-size list.
 */
const insertIntoLargest = (largest: TypedPerfTableRow[], row: TypedPerfTableRow, deviceTime: number) => {
    if (largest.length === MAX_LISTED_OTHER_OPS && deviceTime <= (largest[largest.length - 1].device_time ?? 0)) {
        return;
    }

    const insertAt = largest.findIndex((listed) => deviceTime > (listed.device_time ?? 0));

    largest.splice(insertAt === -1 ? largest.length : insertAt, 0, row);

    if (largest.length > MAX_LISTED_OTHER_OPS) {
        largest.pop();
    }
};

const isDeviceTimeCategory = (category: OperationCategories): category is DeviceTimeCategory =>
    (DEVICE_TIME_CATEGORIES as readonly OperationCategories[]).includes(category);

/**
 * Share of device time in each op category across `rows`, counting rows the way
 * getBoundAnalysisCoverage does so the two figures describe the same time. Returns null when
 * there is no device time to share out, so callers show nothing rather than 0% everywhere.
 */
export const getOpCategoryBreakdown = (rows: TypedPerfTableRow[]): OpCategoryBreakdown | null => {
    const deviceTimeByCategory = new Map<DeviceTimeCategory, number>();
    const largestOtherOps: TypedPerfTableRow[] = [];
    let otherOpCount = 0;
    let totalTime = 0;
    let unclassifiedTime = 0;
    let hasHostOps = false;

    for (const row of rows) {
        const deviceTime = row.device_time;
        // Signposts and placeholders carry no device time, and neither do host ops.
        const isCounted = deviceTime !== null && Number.isFinite(deviceTime) && deviceTime > 0;

        if (row.op_category === OperationCategories.HOST) {
            hasHostOps = true;
        }

        if (isCounted) {
            totalTime += deviceTime;

            if (row.op_category !== null && isDeviceTimeCategory(row.op_category)) {
                deviceTimeByCategory.set(
                    row.op_category,
                    (deviceTimeByCategory.get(row.op_category) ?? 0) + deviceTime,
                );

                if (row.op_category === OperationCategories.OTHER) {
                    otherOpCount += 1;
                    insertIntoLargest(largestOtherOps, row, deviceTime);
                }
            } else {
                unclassifiedTime += deviceTime;
            }
        }
    }

    if (totalTime === 0) {
        return null;
    }

    const percentByCategory = Object.fromEntries(
        DEVICE_TIME_CATEGORIES.map((category) => [
            category,
            ((deviceTimeByCategory.get(category) ?? 0) / totalTime) * 100,
        ]),
    ) as Record<DeviceTimeCategory, number>;

    return {
        percentByCategory,
        unclassifiedPercent: (unclassifiedTime / totalTime) * 100,
        largestOtherOps,
        otherOpCount,
        hasHostOps,
    };
};
