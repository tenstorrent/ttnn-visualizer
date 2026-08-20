// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The pair of reports a piece of graph state was derived for. Paths rather than
 * `ReportFolder` objects: a rebuilt-but-equivalent object would read as a swap.
 */
export interface ReportScope {
    profiler: string | null;
    performance: string | null;
}

export const isSameReportScope = (left: ReportScope, right: ReportScope): boolean =>
    left.profiler === right.profiler && left.performance === right.performance;
