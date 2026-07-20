// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { ReportLocation } from '../src/definitions/Reports';
import {
    ReportLink,
    ReportPairLinkStatus,
    getReportId,
    linkedPerformanceIds,
    linkedProfilerIds,
    unlinkedPerformanceIds,
    unlinkedProfilerIds,
    upsertReportLink,
} from '../src/functions/reportLinks';
import { FolderLinkState, compareByFolderLinkState, getFolderLinkState } from '../src/definitions/FolderLinkStatus';

const link = (
    profilerId: string,
    performanceId: string,
    options: {
        status?: ReportPairLinkStatus;
        performanceHost?: string | null;
        recordedAt?: number;
    } = {},
): ReportLink => ({
    profilerId,
    performanceId,
    status: options.status ?? ReportPairLinkStatus.LINKED,
    recordedAt: options.recordedAt ?? 1,
    performanceAccess: options.performanceHost
        ? {
              location: ReportLocation.REMOTE,
              path: `/remote/${performanceId}`,
              host: options.performanceHost,
          }
        : { location: ReportLocation.LOCAL, path: performanceId },
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

describe('compareByFolderLinkState', () => {
    it('orders linked before unknown before unlinked', () => {
        const linkedIds = new Set(['linked']);
        const unlinkedIds = new Set(['unlinked']);

        expect(compareByFolderLinkState('linked', 'unknown', linkedIds, unlinkedIds)).toBeLessThan(0);
        expect(compareByFolderLinkState('unknown', 'unlinked', linkedIds, unlinkedIds)).toBeLessThan(0);
        expect(compareByFolderLinkState('linked', 'unlinked', linkedIds, unlinkedIds)).toBeLessThan(0);
        expect(compareByFolderLinkState('unlinked', 'linked', linkedIds, unlinkedIds)).toBeGreaterThan(0);
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
    });
});
