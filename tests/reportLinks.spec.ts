// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { ReportLocation } from '../src/definitions/Reports';
import { ReportLink, addReportLink, linkedPerformancePaths, linkedProfilerPaths } from '../src/functions/reportLinks';

const link = (profilerPath: string, performancePath: string): ReportLink => ({
    profilerPath,
    profilerLocation: ReportLocation.LOCAL,
    performancePath,
    performanceLocation: ReportLocation.LOCAL,
});

describe('reportLinks', () => {
    describe('addReportLink', () => {
        it('appends a new pair', () => {
            const result = addReportLink([], link('mem-a', 'perf-a'));
            expect(result).toHaveLength(1);
        });

        it('dedupes an identical pair', () => {
            const links = [link('mem-a', 'perf-a')];
            const result = addReportLink(links, link('mem-a', 'perf-a'));
            expect(result).toBe(links);
            expect(result).toHaveLength(1);
        });

        it('keeps distinct pairs that share one side (many-to-many)', () => {
            let links = addReportLink([], link('mem-a', 'perf-a'));
            links = addReportLink(links, link('mem-a', 'perf-b'));
            links = addReportLink(links, link('mem-b', 'perf-a'));
            expect(links).toHaveLength(3);
        });

        it('treats a differing location as a distinct pair', () => {
            const links = [link('mem-a', 'perf-a')];
            const result = addReportLink(links, {
                ...link('mem-a', 'perf-a'),
                performanceLocation: ReportLocation.REMOTE,
            });
            expect(result).toHaveLength(2);
        });
    });

    describe('linkedPerformancePaths', () => {
        const links = [link('mem-a', 'perf-a'), link('mem-a', 'perf-b'), link('mem-b', 'perf-c')];

        it('returns every performance counterpart of the given memory report', () => {
            const result = linkedPerformancePaths(links, 'mem-a', ReportLocation.LOCAL);
            expect(result).toEqual(new Set(['perf-a', 'perf-b']));
        });

        it('returns an empty set when no memory report is active', () => {
            expect(linkedPerformancePaths(links, null, null).size).toBe(0);
        });

        it('does not match when the location differs', () => {
            expect(linkedPerformancePaths(links, 'mem-a', ReportLocation.REMOTE).size).toBe(0);
        });
    });

    describe('linkedProfilerPaths', () => {
        const links = [link('mem-a', 'perf-a'), link('mem-b', 'perf-a'), link('mem-c', 'perf-b')];

        it('returns every memory counterpart of the given performance report', () => {
            const result = linkedProfilerPaths(links, 'perf-a', ReportLocation.LOCAL);
            expect(result).toEqual(new Set(['mem-a', 'mem-b']));
        });

        it('returns an empty set when no performance report is active', () => {
            expect(linkedProfilerPaths(links, undefined, undefined).size).toBe(0);
        });
    });
});
