// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { ReportLocation } from '../src/definitions/Reports';
import {
    MAX_REPORT_LINKS,
    ReportLink,
    ReportPairLinkStatus,
    capReportLinks,
    linkedPerformancePaths,
    linkedProfilerPaths,
    pruneReportLinksForReport,
    readReportLinksFromStorage,
    resolveRemoteReportIdentity,
    unlinkedPerformancePaths,
    unlinkedProfilerPaths,
    upsertReportLink,
} from '../src/functions/reportLinks';

const link = (
    profilerPath: string,
    performancePath: string,
    options: {
        profilerHost?: string | null;
        performanceHost?: string | null;
        status?: ReportPairLinkStatus;
        recordedAt?: number;
    } = {},
): ReportLink => ({
    profilerPath,
    profilerLocation: options.profilerHost ? ReportLocation.REMOTE : ReportLocation.LOCAL,
    profilerHost: options.profilerHost ?? null,
    performancePath,
    performanceLocation: options.performanceHost ? ReportLocation.REMOTE : ReportLocation.LOCAL,
    performanceHost: options.performanceHost ?? null,
    status: options.status ?? ReportPairLinkStatus.LINKED,
    recordedAt: options.recordedAt ?? 1,
});

describe('reportLinks', () => {
    describe('upsertReportLink', () => {
        it('appends a new pair', () => {
            const result = upsertReportLink([], link('mem-a', 'perf-a'));
            expect(result).toHaveLength(1);
            expect(result[0].status).toBe(ReportPairLinkStatus.LINKED);
        });

        it('updates status on an existing pair', () => {
            const links = [link('mem-a', 'perf-a', { recordedAt: 1 })];
            const result = upsertReportLink(
                links,
                link('mem-a', 'perf-a', { status: ReportPairLinkStatus.UNLINKED, recordedAt: 99 }),
            );
            expect(result).toHaveLength(1);
            expect(result[0].status).toBe(ReportPairLinkStatus.UNLINKED);
        });

        it('returns the same reference when status is unchanged', () => {
            const links = [link('mem-a', 'perf-a')];
            expect(upsertReportLink(links, link('mem-a', 'perf-a', { recordedAt: 99 }))).toBe(links);
        });
        it('keeps distinct pairs that share one side (many-to-many)', () => {
            let links = upsertReportLink([], link('mem-a', 'perf-a'));
            links = upsertReportLink(links, link('mem-a', 'perf-b'));
            links = upsertReportLink(links, link('mem-b', 'perf-a'));
            expect(links).toHaveLength(3);
        });

        it('treats the same remote path on different hosts as distinct pairs', () => {
            let links = upsertReportLink(
                [],
                link('mem-a', 'perf-a', { profilerHost: 'host-a', performanceHost: 'host-a' }),
            );
            links = upsertReportLink(
                links,
                link('mem-a', 'perf-a', { profilerHost: 'host-b', performanceHost: 'host-b' }),
            );
            expect(links).toHaveLength(2);
        });

        it('caps growth at MAX_REPORT_LINKS keeping the newest entries', () => {
            let links: ReportLink[] = [];
            for (let i = 0; i < MAX_REPORT_LINKS + 5; i++) {
                links = upsertReportLink(links, link(`mem-${i}`, `perf-${i}`, { recordedAt: i }));
            }
            expect(links).toHaveLength(MAX_REPORT_LINKS);
            expect(links[0].profilerPath).toBe('mem-5');
            expect(links[links.length - 1].profilerPath).toBe(`mem-${MAX_REPORT_LINKS + 4}`);
        });
    });

    describe('capReportLinks', () => {
        it('returns the same reference when under the cap', () => {
            const links = [link('mem-a', 'perf-a')];
            expect(capReportLinks(links)).toBe(links);
        });
    });

    describe('pruneReportLinksForReport', () => {
        it('removes pairs referencing the report on either side', () => {
            const links = [
                link('mem-a', 'perf-a'),
                link('mem-a', 'perf-b'),
                link('mem-b', 'perf-a'),
                link('mem-c', 'perf-c'),
            ];
            const result = pruneReportLinksForReport(links, 'mem-a', ReportLocation.LOCAL, null);
            expect(result.map((entry) => `${entry.profilerPath}:${entry.performancePath}`)).toEqual([
                'mem-b:perf-a',
                'mem-c:perf-c',
            ]);
        });

        it('scopes remote prune by host', () => {
            const links = [
                link('mem-a', 'perf-a', { profilerHost: 'host-a', performanceHost: 'host-a' }),
                link('mem-a', 'perf-b', { profilerHost: 'host-b', performanceHost: 'host-b' }),
            ];
            const result = pruneReportLinksForReport(links, 'mem-a', ReportLocation.REMOTE, 'host-a');
            expect(result).toHaveLength(1);
            expect(result[0].profilerHost).toBe('host-b');
        });
    });

    describe('linkedPerformancePaths', () => {
        const links = [
            link('mem-a', 'perf-a'),
            link('mem-a', 'perf-b'),
            link('mem-a', 'perf-x', { status: ReportPairLinkStatus.UNLINKED }),
            link('mem-b', 'perf-c'),
        ];

        it('returns linked performance counterparts only', () => {
            expect(linkedPerformancePaths(links, 'mem-a', ReportLocation.LOCAL)).toEqual(new Set(['perf-a', 'perf-b']));
        });

        it('scopes remote counterparts to the requested host', () => {
            const remoteLinks = [
                link('mem-a', 'perf-a', { profilerHost: 'host-a', performanceHost: 'host-a' }),
                link('mem-a', 'perf-b', { profilerHost: 'host-a', performanceHost: 'host-b' }),
            ];

            expect(linkedPerformancePaths(remoteLinks, 'mem-a', ReportLocation.REMOTE, 'host-a', 'host-a')).toEqual(
                new Set(['perf-a']),
            );
        });
    });

    describe('linkedProfilerPaths', () => {
        const links = [link('mem-a', 'perf-a'), link('mem-b', 'perf-a'), link('mem-c', 'perf-b')];

        it('returns every memory counterpart of the given performance report', () => {
            expect(linkedProfilerPaths(links, 'perf-a', ReportLocation.LOCAL)).toEqual(new Set(['mem-a', 'mem-b']));
        });
    });

    describe('unlinkedPerformancePaths / unlinkedProfilerPaths', () => {
        const links = [
            link('mem-a', 'perf-x', { status: ReportPairLinkStatus.UNLINKED }),
            link('mem-b', 'perf-y', { status: ReportPairLinkStatus.UNLINKED }),
            link('mem-a', 'perf-z'),
        ];

        it('returns failed performance counterparts of the active memory report', () => {
            expect(unlinkedPerformancePaths(links, 'mem-a', ReportLocation.LOCAL)).toEqual(new Set(['perf-x']));
        });

        it('returns failed memory counterparts of the active performance report', () => {
            expect(unlinkedProfilerPaths(links, 'perf-y', ReportLocation.LOCAL)).toEqual(new Set(['mem-b']));
        });
    });

    describe('resolveRemoteReportIdentity', () => {
        const folders = [
            { reportName: 'run-a', remotePath: '/remote/reports/run-a', lastModified: 1 },
            { reportName: 'run-b', remotePath: '/remote/reports/run-b', lastModified: 2 },
        ];

        it('resolves a basename to the full remotePath', () => {
            expect(resolveRemoteReportIdentity(folders, 'run-a', 'host-a')).toEqual({
                path: '/remote/reports/run-a',
                location: ReportLocation.REMOTE,
                host: 'host-a',
            });
        });

        it('keeps an exact remotePath', () => {
            expect(resolveRemoteReportIdentity(folders, '/remote/reports/run-b', 'host-a')?.path).toBe(
                '/remote/reports/run-b',
            );
        });
    });

    describe('readReportLinksFromStorage', () => {
        it('reads and normalises the unified reportLinks key', () => {
            const store: Record<string, string> = {
                reportLinks: JSON.stringify([
                    {
                        profilerPath: 'mem-a',
                        profilerLocation: ReportLocation.LOCAL,
                        performancePath: 'perf-a',
                        performanceLocation: ReportLocation.LOCAL,
                        status: ReportPairLinkStatus.LINKED,
                        recordedAt: 1,
                    },
                    {
                        profilerPath: 'mem-a',
                        profilerLocation: ReportLocation.LOCAL,
                        performancePath: 'perf-b',
                        performanceLocation: ReportLocation.LOCAL,
                        status: ReportPairLinkStatus.UNLINKED,
                        recordedAt: 2,
                    },
                    { profilerPath: 'incomplete' },
                ]),
            };

            const storage = {
                getItem: (key: string) => store[key] ?? null,
                setItem: (key: string, value: string) => {
                    store[key] = value;
                },
                removeItem: (key: string) => {
                    delete store[key];
                },
            } as unknown as Storage;

            const result = readReportLinksFromStorage(storage);
            expect(result).toHaveLength(2);
            expect(result.map((entry) => entry.status).sort()).toEqual([
                ReportPairLinkStatus.LINKED,
                ReportPairLinkStatus.UNLINKED,
            ]);
        });

        it('returns an empty list when the key is missing or invalid', () => {
            const empty = { getItem: () => null } as unknown as Storage;
            expect(readReportLinksFromStorage(empty)).toEqual([]);

            const invalid = { getItem: () => 'not-json' } as unknown as Storage;
            expect(readReportLinksFromStorage(invalid)).toEqual([]);
        });
    });
});
