// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { ReportLocation } from '../src/definitions/Reports';
import { MAX_REPORT_LINKS, ReportLinkRole, ReportPairLinkStatus } from '../src/definitions/ReportLinks';
import { ReportLink } from '../src/model/ReportLinks';
import {
    createReportLinkAccess,
    getFolderReportId,
    getReportId,
    linkedPerformanceIds,
    linkedProfilerIds,
    removeReportLinksFor,
    unlinkedPerformanceIds,
    unlinkedProfilerIds,
    upsertReportLink,
} from '../src/functions/reportLinks';
import { FolderLinkState } from '../src/definitions/FolderLinkStatus';
import { getFolderLinkState, shouldShowFolderLinkStatus } from '../src/functions/folderLinkStatus';
import { createReportLink } from './helpers/reportLinkFixtures';

const link = (
    profilerId: string,
    performanceId: string,
    options: {
        status?: ReportPairLinkStatus;
        profilerHost?: string | null;
        performanceHost?: string | null;
        recordedAt?: number;
    } = {},
): ReportLink =>
    createReportLink(profilerId, performanceId, {
        status: options.status ?? ReportPairLinkStatus.LINKED,
        recordedAt: options.recordedAt ?? 1,
        profilerAccess: options.profilerHost
            ? {
                  location: ReportLocation.REMOTE,
                  path: `/remote/${profilerId}`,
                  host: options.profilerHost,
              }
            : { location: ReportLocation.LOCAL, path: profilerId },
        performanceAccess: options.performanceHost
            ? {
                  location: ReportLocation.REMOTE,
                  path: `/remote/${performanceId}`,
                  host: options.performanceHost,
              }
            : { location: ReportLocation.LOCAL, path: performanceId },
    });

describe('getFolderReportId', () => {
    it('prefers the synced folder name over the path', () => {
        expect(getFolderReportId({ path: '/data/local/local-copy', syncedName: 'remote-run' })).toBe('remote-run');
    });

    it('falls back to the path basename, and to null without a folder', () => {
        expect(getFolderReportId({ path: '/data/local/mem-run' })).toBe('mem-run');
        expect(getFolderReportId(null)).toBeNull();
    });
});

describe('getReportId', () => {
    it('uses the final path segment', () => {
        expect(getReportId('/remote/profiler/reports/resnet50')).toBe('resnet50');
        expect(getReportId('resnet50')).toBe('resnet50');
    });

    it('falls back to later candidates when earlier are empty', () => {
        expect(getReportId(null, undefined, '/a/b/perf-run')).toBe('perf-run');
    });

    it('prefers path basename over a differing display name', () => {
        expect(getReportId('/remote/profiler/reports/resnet50', 'Pretty Display Name')).toBe('resnet50');
    });

    it('rejects separator-only paths so they do not become shared ids', () => {
        expect(getReportId('/')).toBeNull();
        expect(getReportId('\\')).toBeNull();
        expect(getReportId('/', 'resnet50')).toBe('resnet50');
    });
});

describe('createReportLinkAccess', () => {
    it('keeps the host for a remote report', () => {
        expect(createReportLinkAccess(ReportLocation.REMOTE, '/remote/run', 'host-1')).toEqual({
            location: ReportLocation.REMOTE,
            path: '/remote/run',
            host: 'host-1',
        });
    });

    // A local side carrying the selected host would be scoped out of other hosts' pickers.
    it('drops the host for a local report even when a connection is selected', () => {
        expect(createReportLinkAccess(ReportLocation.LOCAL, 'run', 'host-1').host).toBeNull();
    });
});

describe('getFolderLinkState', () => {
    it('returns linked, unlinked, or unknown', () => {
        expect(getFolderLinkState('a', new Set(['a']), new Set())).toBe(FolderLinkState.LINKED);
        expect(getFolderLinkState('b', new Set(), new Set(['b']))).toBe(FolderLinkState.UNLINKED);
        expect(getFolderLinkState('c', new Set(['a']), new Set(['b']))).toBe(FolderLinkState.UNKNOWN);
    });

    it('treats linked as winning over unlinked for the same id', () => {
        expect(getFolderLinkState('a', new Set(['a']), new Set(['a']))).toBe(FolderLinkState.LINKED);
    });
});

describe('shouldShowFolderLinkStatus', () => {
    it('hides badges when both sets are empty or null', () => {
        expect(shouldShowFolderLinkStatus(new Set(), new Set())).toBe(false);
        expect(shouldShowFolderLinkStatus(null, null)).toBe(false);
        expect(shouldShowFolderLinkStatus(new Set(['a']), new Set())).toBe(true);
    });
});

describe('reportLinks', () => {
    describe('upsertReportLink', () => {
        it('appends a new pair', () => {
            const result = upsertReportLink([], link('mem-a', 'perf-a'));
            expect(result).toHaveLength(1);
            expect(result[0].status).toBe(ReportPairLinkStatus.LINKED);
        });

        it('updates status on an existing pair', () => {
            const links = [link('mem-a', 'perf-a')];
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

        it(`drops the oldest pair once ${MAX_REPORT_LINKS} are stored`, () => {
            const full = Array.from({ length: MAX_REPORT_LINKS }, (_, index) => link(`mem-${index}`, 'perf'));
            const result = upsertReportLink(full, link('mem-new', 'perf'));

            expect(result).toHaveLength(MAX_REPORT_LINKS);
            expect(result.some((entry) => entry.profilerId === 'mem-0')).toBe(false);
            expect(result[result.length - 1].profilerId).toBe('mem-new');
        });

        it('moves a pair whose status changed to the end so it survives the next eviction', () => {
            const full = Array.from({ length: MAX_REPORT_LINKS }, (_, index) => link(`mem-${index}`, 'perf'));
            let result = upsertReportLink(full, link('mem-0', 'perf', { status: ReportPairLinkStatus.UNLINKED }));
            result = upsertReportLink(result, link('mem-new', 'perf'));

            expect(result).toHaveLength(MAX_REPORT_LINKS);
            expect(result.find((entry) => entry.profilerId === 'mem-0')?.status).toBe(ReportPairLinkStatus.UNLINKED);
            expect(result.some((entry) => entry.profilerId === 'mem-1')).toBe(false);
        });
    });

    describe('removeReportLinksFor', () => {
        // 'shared' is a profiler id in one pair and a performance id in another.
        const links = [link('shared', 'perf-a'), link('mem-b', 'shared'), link('mem-c', 'perf-c')];

        it('removes only pairs whose given side matches', () => {
            expect(removeReportLinksFor(links, ReportLinkRole.PROFILER, 'shared')).toEqual([links[1], links[2]]);
            expect(removeReportLinksFor(links, ReportLinkRole.PERFORMANCE, 'shared')).toEqual([links[0], links[2]]);
        });

        it('returns the same reference when nothing matches', () => {
            expect(removeReportLinksFor(links, ReportLinkRole.PROFILER, 'missing')).toBe(links);
        });

        it('is a no-op for a null id', () => {
            expect(removeReportLinksFor(links, ReportLinkRole.PROFILER, null)).toBe(links);
        });
    });

    describe('linked / unlinked id lookups', () => {
        const links = [
            link('mem-a', 'perf-a'),
            link('mem-a', 'perf-b', { status: ReportPairLinkStatus.UNLINKED }),
            link('mem-b', 'perf-c'),
        ];

        it('returns linked performance counterparts', () => {
            expect(linkedPerformanceIds(links, 'mem-a')).toEqual(new Set(['perf-a']));
        });

        it('returns unlinked performance counterparts', () => {
            expect(unlinkedPerformanceIds(links, 'mem-a')).toEqual(new Set(['perf-b']));
        });

        it('matches across local/remote — location is not part of the key', () => {
            const mixed = [
                link('mem-a', 'perf-a', {
                    performanceHost: 'h1',
                }),
            ];
            expect(linkedPerformanceIds(mixed, 'mem-a')).toEqual(new Set(['perf-a']));
        });

        it('scopes out counterparts recorded only on another remote host', () => {
            const withHosts = [
                link('mem-a', 'perf-local'),
                link('mem-a', 'perf-h1', { performanceHost: 'host-1' }),
                link('mem-a', 'perf-h2', { performanceHost: 'host-2' }),
            ];

            expect(linkedPerformanceIds(withHosts, 'mem-a', { remoteHost: 'host-1' })).toEqual(
                new Set(['perf-local', 'perf-h1']),
            );
        });

        it('returns linked profiler counterparts', () => {
            expect(linkedProfilerIds(links, 'perf-c')).toEqual(new Set(['mem-b']));
            expect(unlinkedProfilerIds(links, 'perf-b')).toEqual(new Set(['mem-a']));
        });

        it('scopes profiler counterparts by their own access host', () => {
            const withHosts = [
                link('mem-local', 'perf-a'),
                link('mem-h1', 'perf-a', { profilerHost: 'host-1' }),
                link('mem-h2', 'perf-a', { profilerHost: 'host-2', performanceHost: 'host-1' }),
            ];

            expect(linkedProfilerIds(withHosts, 'perf-a', { remoteHost: 'host-1' })).toEqual(
                new Set(['mem-local', 'mem-h1']),
            );
        });
    });
});
