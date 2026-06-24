// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { ReportLocation } from '../definitions/Reports';

/**
 * A memory (profiler) report and a performance report that were observed to link
 * successfully — i.e. their device operation sequences matched while both were active.
 *
 * The match is a heuristic on the operation sequence, so this is intentionally
 * many-to-many: one report can link with several counterparts (including reports from
 * different runs that happen to share an operation sequence). Each distinct pair is
 * stored separately and never collapsed to a single partner.
 */
export interface ReportLink {
    profilerPath: string;
    profilerLocation: ReportLocation;
    performancePath: string;
    performanceLocation: ReportLocation;
}

const isSamePair = (a: ReportLink, b: ReportLink): boolean =>
    a.profilerPath === b.profilerPath &&
    a.profilerLocation === b.profilerLocation &&
    a.performancePath === b.performancePath &&
    a.performanceLocation === b.performanceLocation;

/**
 * Returns the list with `next` appended, deduping on the full pair so a report can
 * accumulate multiple distinct counterparts without duplicate entries.
 */
export const addReportLink = (links: ReportLink[], next: ReportLink): ReportLink[] =>
    links.some((link) => isSamePair(link, next)) ? links : [...links, next];

/**
 * Performance report paths recorded as linked with the given (active) memory report.
 */
export const linkedPerformancePaths = (
    links: ReportLink[],
    profilerPath: string | null | undefined,
    profilerLocation: ReportLocation | null | undefined,
): Set<string> => {
    if (!profilerPath || !profilerLocation) {
        return new Set();
    }

    return new Set(
        links
            .filter((link) => link.profilerPath === profilerPath && link.profilerLocation === profilerLocation)
            .map((link) => link.performancePath),
    );
};

/**
 * Memory report paths recorded as linked with the given (active) performance report.
 */
export const linkedProfilerPaths = (
    links: ReportLink[],
    performancePath: string | null | undefined,
    performanceLocation: ReportLocation | null | undefined,
): Set<string> => {
    if (!performancePath || !performanceLocation) {
        return new Set();
    }

    return new Set(
        links
            .filter(
                (link) => link.performancePath === performancePath && link.performanceLocation === performanceLocation,
            )
            .map((link) => link.profilerPath),
    );
};
