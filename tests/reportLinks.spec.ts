// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { ReportLocation } from '../src/definitions/Reports';
import {
    MAX_REPORT_LINKS,
    ReportLinkMatchResult,
    ReportLinkRole,
    ReportLinkRunsById,
    ReportPairLinkStatus,
} from '../src/definitions/ReportLinks';
import { ReportLink } from '../src/model/ReportLinks';
import {
    createReportLinkAccess,
    getFolderReportId,
    getReportId,
    isSameRun,
    isSettledLinkMatch,
    linkedPerformanceRuns,
    linkedProfilerRuns,
    removeReportLinksFor,
    unlinkedPerformanceRuns,
    unlinkedProfilerRuns,
    upsertReportLink,
} from '../src/functions/reportLinks';
import { FolderLinkState } from '../src/definitions/FolderLinkStatus';
import { getFolderLinkState, shouldShowFolderLinkStatus } from '../src/functions/folderLinkStatus';
import { createReportLink, runsWithoutFingerprints } from './helpers/reportLinkFixtures';

const RUN_A = 'v1:run-a';
const RUN_B = 'v1:run-b';

const idsOf = (runsById: ReportLinkRunsById): Set<string> => new Set(runsById.keys());

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

describe('isSettledLinkMatch', () => {
    it.each([
        [ReportLinkMatchResult.LINKED, true],
        [ReportLinkMatchResult.UNLINKED, true],
        [ReportLinkMatchResult.PENDING, false],
        [ReportLinkMatchResult.UNAVAILABLE, false],
    ])('treats %s as settled: %s', (result, settled) => {
        expect(isSettledLinkMatch(result)).toBe(settled);
    });
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

describe('isSameRun', () => {
    it.each([
        [RUN_A, RUN_A, true],
        [RUN_A, RUN_B, false],
        [undefined, RUN_A, true],
        [RUN_A, null, true],
        [RUN_A, undefined, true],
        [undefined, null, true],
    ])('stored %s against current %s is %s', (stored, current, expected) => {
        expect(isSameRun(stored, current)).toBe(expected);
    });
});

describe('getFolderLinkState', () => {
    const none = runsWithoutFingerprints();

    it('returns linked, unlinked, or unknown', () => {
        expect(getFolderLinkState('a', null, runsWithoutFingerprints('a'), none)).toBe(FolderLinkState.LINKED);
        expect(getFolderLinkState('b', null, none, runsWithoutFingerprints('b'))).toBe(FolderLinkState.UNLINKED);
        expect(getFolderLinkState('c', null, runsWithoutFingerprints('a'), runsWithoutFingerprints('b'))).toBe(
            FolderLinkState.UNKNOWN,
        );
    });

    it('treats linked as winning over unlinked for the same id', () => {
        expect(getFolderLinkState('a', null, runsWithoutFingerprints('a'), runsWithoutFingerprints('a'))).toBe(
            FolderLinkState.LINKED,
        );
    });

    it('ignores a link recorded against another run in the same folder', () => {
        const linkedRuns = new Map([['a', [RUN_A]]]);

        expect(getFolderLinkState('a', RUN_A, linkedRuns, none)).toBe(FolderLinkState.LINKED);
        expect(getFolderLinkState('a', RUN_B, linkedRuns, none)).toBe(FolderLinkState.UNKNOWN);
    });

    it('still badges a folder whose current run is unknown', () => {
        expect(getFolderLinkState('a', null, new Map([['a', [RUN_A]]]), none)).toBe(FolderLinkState.LINKED);
    });

    it('matches when any of the runs recorded for the folder is its current run', () => {
        expect(getFolderLinkState('a', RUN_B, new Map([['a', [RUN_A, RUN_B]]]), none)).toBe(FolderLinkState.LINKED);
    });

    it('falls back to unlinked when only the unlinked verdict is for the current run', () => {
        expect(getFolderLinkState('a', RUN_B, new Map([['a', [RUN_A]]]), new Map([['a', [RUN_B]]]))).toBe(
            FolderLinkState.UNLINKED,
        );
    });
});

describe('shouldShowFolderLinkStatus', () => {
    it('hides badges when both maps are empty or null', () => {
        expect(shouldShowFolderLinkStatus(runsWithoutFingerprints(), runsWithoutFingerprints())).toBe(false);
        expect(shouldShowFolderLinkStatus(null, null)).toBe(false);
        expect(shouldShowFolderLinkStatus(runsWithoutFingerprints('a'), runsWithoutFingerprints())).toBe(true);
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

        // `recordedAt` changes on every comparison, so counting it would make every re-run a change.
        it('returns the same reference when the last pair is seen again unchanged', () => {
            const links = [link('mem-b', 'perf-b'), link('mem-a', 'perf-a', { profilerHost: 'h1' })];
            expect(upsertReportLink(links, link('mem-a', 'perf-a', { profilerHost: 'h1', recordedAt: 99 }))).toBe(
                links,
            );
        });

        it.each([
            ['profiler', { profilerRun: RUN_B }],
            ['performance', { performanceRun: RUN_B }],
        ])('replaces the last pair when a new %s run is compared', (_side, nextRuns) => {
            const links = [createReportLink('mem-a', 'perf-a', { profilerRun: RUN_A, performanceRun: RUN_A })];
            const next = createReportLink('mem-a', 'perf-a', {
                profilerRun: RUN_A,
                performanceRun: RUN_A,
                ...nextRuns,
                status: ReportPairLinkStatus.UNLINKED,
                recordedAt: 2,
            });

            expect(upsertReportLink(links, next)).toEqual([next]);
        });

        it('replaces the last pair when only a run changes', () => {
            const links = [createReportLink('mem-a', 'perf-a', { performanceRun: RUN_A })];
            const next = createReportLink('mem-a', 'perf-a', { performanceRun: RUN_B, recordedAt: 2 });

            const result = upsertReportLink(links, next);

            expect(result).not.toBe(links);
            expect(result).toEqual([next]);
        });

        it('treats a missing host and a null host as the same access', () => {
            const access = createReportLinkAccess(ReportLocation.LOCAL, 'mem-a', null);
            const links = [createReportLink('mem-a', 'perf-a', { profilerAccess: { ...access, host: undefined } })];

            expect(upsertReportLink(links, createReportLink('mem-a', 'perf-a', { profilerAccess: access }))).toBe(
                links,
            );
        });

        // The remote picker scopes badges by the stored host, so a stale one hides the badge on the new host.
        // The ticket's case: a performance report synced from `h1`, then compared from `h2`.
        it('replaces the last pair when only its performance host changes', () => {
            const links = [link('mem-a', 'perf-a', { performanceHost: 'h1' })];
            const result = upsertReportLink(links, link('mem-a', 'perf-a', { performanceHost: 'h2' }));

            expect(result).not.toBe(links);
            expect(result).toEqual([
                expect.objectContaining({
                    performanceAccess: createReportLinkAccess(ReportLocation.REMOTE, '/remote/perf-a', 'h2'),
                }),
            ]);
        });

        it('appends a different pair even when its access matches the last pair', () => {
            const links = [link('mem-a', 'perf-a')];
            const result = upsertReportLink(links, { ...links[0], profilerId: 'mem-b', performanceId: 'perf-b' });

            expect(result.map((entry) => entry.profilerId)).toEqual(['mem-a', 'mem-b']);
        });

        it('replaces a pair seen again from a different remote host and moves it to the end', () => {
            const links = [link('mem-a', 'perf-a', { performanceHost: 'h1' }), link('mem-b', 'perf-b')];
            const result = upsertReportLink(links, link('mem-a', 'perf-a', { performanceHost: 'h2', recordedAt: 99 }));

            expect(result).toHaveLength(2);
            expect(result[1]).toMatchObject({
                profilerId: 'mem-a',
                recordedAt: 99,
                performanceAccess: createReportLinkAccess(ReportLocation.REMOTE, '/remote/perf-a', 'h2'),
            });
        });

        it.each([
            // No host, so only the location differs from the stored local access.
            ['location', createReportLinkAccess(ReportLocation.REMOTE, 'mem-a', null)],
            ['path', createReportLinkAccess(ReportLocation.LOCAL, 'mem-a-moved', null)],
        ])('replaces the last pair when only its %s changes', (_field, profilerAccess) => {
            const links = [link('mem-a', 'perf-a')];
            const result = upsertReportLink(
                links,
                createReportLink('mem-a', 'perf-a', { ...links[0], profilerAccess }),
            );

            expect(result).not.toBe(links);
            expect(result).toEqual([expect.objectContaining({ profilerAccess })]);
        });

        it('moves an unchanged pair that is not last to the end with the new recordedAt', () => {
            const links = [link('mem-a', 'perf-a'), link('mem-b', 'perf-b')];
            const result = upsertReportLink(links, link('mem-a', 'perf-a', { recordedAt: 99 }));

            expect(result.map((entry) => entry.profilerId)).toEqual(['mem-b', 'mem-a']);
            expect(result[1].recordedAt).toBe(99);
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

        // A pair compared often but always with the same verdict must not age out behind pairs seen once.
        it('moves a pair seen again unchanged to the end so it survives the next eviction', () => {
            const full = Array.from({ length: MAX_REPORT_LINKS }, (_, index) => link(`mem-${index}`, 'perf'));
            let result = upsertReportLink(full, link('mem-0', 'perf'));
            result = upsertReportLink(result, link('mem-new', 'perf'));

            expect(result).toHaveLength(MAX_REPORT_LINKS);
            expect(result.some((entry) => entry.profilerId === 'mem-0')).toBe(true);
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

    describe('run-aware lookups', () => {
        const runLink = (profilerRun?: string, performanceRun?: string, performanceId = 'perf-a') =>
            createReportLink('mem-a', performanceId, { profilerRun, performanceRun });

        it('drops links recorded against another run of the active folder', () => {
            const links = [runLink(RUN_A, RUN_A, 'perf-old'), runLink(RUN_B, RUN_A, 'perf-new')];

            expect(idsOf(linkedPerformanceRuns(links, 'mem-a', { activeRun: RUN_B }))).toEqual(new Set(['perf-new']));
        });

        it('keeps every link while the active run is unknown', () => {
            const links = [runLink(RUN_A, RUN_A, 'perf-old'), runLink(RUN_B, RUN_A, 'perf-new')];

            expect(idsOf(linkedPerformanceRuns(links, 'mem-a', { activeRun: null }))).toEqual(
                new Set(['perf-old', 'perf-new']),
            );
        });

        it('keeps a link stored before runs were recorded', () => {
            expect(idsOf(linkedPerformanceRuns([runLink()], 'mem-a', { activeRun: RUN_A }))).toEqual(
                new Set(['perf-a']),
            );
        });

        it('collects each counterpart run its links recorded', () => {
            const links = [
                createReportLink('mem-a', 'perf-a', { performanceRun: RUN_A }),
                createReportLink('mem-a', 'perf-a', { performanceRun: RUN_B, profilerRun: RUN_A }),
            ];

            expect(linkedPerformanceRuns(links, 'mem-a')).toEqual(new Map([['perf-a', [RUN_A, RUN_B]]]));
        });

        it('checks the active performance run for profiler counterparts', () => {
            const links = [createReportLink('mem-a', 'perf-a', { performanceRun: RUN_A, profilerRun: RUN_B })];

            expect(linkedProfilerRuns(links, 'perf-a', { activeRun: RUN_A })).toEqual(new Map([['mem-a', [RUN_B]]]));
            expect(linkedProfilerRuns(links, 'perf-a', { activeRun: RUN_B }).size).toBe(0);
        });
    });

    describe('linked / unlinked id lookups', () => {
        const links = [
            link('mem-a', 'perf-a'),
            link('mem-a', 'perf-b', { status: ReportPairLinkStatus.UNLINKED }),
            link('mem-b', 'perf-c'),
        ];

        it('returns linked performance counterparts', () => {
            expect(idsOf(linkedPerformanceRuns(links, 'mem-a'))).toEqual(new Set(['perf-a']));
        });

        it('returns unlinked performance counterparts', () => {
            expect(idsOf(unlinkedPerformanceRuns(links, 'mem-a'))).toEqual(new Set(['perf-b']));
        });

        it('matches across local/remote — location is not part of the key', () => {
            const mixed = [
                link('mem-a', 'perf-a', {
                    performanceHost: 'h1',
                }),
            ];
            expect(idsOf(linkedPerformanceRuns(mixed, 'mem-a'))).toEqual(new Set(['perf-a']));
        });

        it('scopes out counterparts recorded only on another remote host', () => {
            const withHosts = [
                link('mem-a', 'perf-local'),
                link('mem-a', 'perf-h1', { performanceHost: 'host-1' }),
                link('mem-a', 'perf-h2', { performanceHost: 'host-2' }),
            ];

            expect(idsOf(linkedPerformanceRuns(withHosts, 'mem-a', { remoteHost: 'host-1' }))).toEqual(
                new Set(['perf-local', 'perf-h1']),
            );
        });

        it('returns linked profiler counterparts', () => {
            expect(idsOf(linkedProfilerRuns(links, 'perf-c'))).toEqual(new Set(['mem-b']));
            expect(idsOf(unlinkedProfilerRuns(links, 'perf-b'))).toEqual(new Set(['mem-a']));
        });

        it('scopes profiler counterparts by their own access host', () => {
            const withHosts = [
                link('mem-local', 'perf-a'),
                link('mem-h1', 'perf-a', { profilerHost: 'host-1' }),
                link('mem-h2', 'perf-a', { profilerHost: 'host-2', performanceHost: 'host-1' }),
            ];

            expect(idsOf(linkedProfilerRuns(withHosts, 'perf-a', { remoteHost: 'host-1' }))).toEqual(
                new Set(['mem-local', 'mem-h1']),
            );
        });
    });
});
