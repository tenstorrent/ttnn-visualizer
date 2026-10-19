// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportPairLinkStatus } from '../src/definitions/ReportLinks';
import { ReportLocation } from '../src/definitions/Reports';
import { useReportLinkBadgeRuns } from '../src/hooks/useReportLinkBadgeRuns';
import type { ActiveReportFingerprints, ReportLink } from '../src/model/ReportLinks';
import { activePerformanceReportAtom, activeProfilerReportAtom, reportLinksAtom } from '../src/store/app';
import { AtomProvider, type AtomProviderInitialValues } from './helpers/atomProvider';
import { PERFORMANCE_REPORT, PROFILER_REPORT, createReportLink } from './helpers/reportLinkFixtures';

const activeRunsState = vi.hoisted(() => ({
    data: undefined as ActiveReportFingerprints | undefined,
}));

vi.mock('../src/hooks/useAPI', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/hooks/useAPI')>()),
    useActiveReportFingerprints: () => ({ data: activeRunsState.data }),
}));

const idsOf = (runsById: ReadonlyMap<string, unknown>): Set<string> => new Set(runsById.keys());

// Defaults to the active pair, so each case overrides only the side it is about.
const link = (overrides: Partial<ReportLink>): ReportLink => createReportLink('mem-run', 'perf-run', overrides);

function renderBadgeIds(links: ReportLink[], remoteHost?: string | null) {
    const initialValues = [
        [reportLinksAtom, links],
        [activeProfilerReportAtom, PROFILER_REPORT],
        [activePerformanceReportAtom, PERFORMANCE_REPORT],
    ] as AtomProviderInitialValues;

    return renderHook(() => useReportLinkBadgeRuns(remoteHost === undefined ? undefined : { remoteHost }), {
        wrapper: ({ children }: { children: ReactNode }) => (
            <AtomProvider initialValues={initialValues}>{children}</AtomProvider>
        ),
    }).result;
}

describe('useReportLinkBadgeRuns', () => {
    beforeEach(() => {
        activeRunsState.data = undefined;
    });

    it('returns empty maps rather than null when nothing is linked', () => {
        // Not null: the hook previously returned null throughout while report linking was
        // gated off, and a picker treating "no badges yet" as "badges unavailable" would
        // hide them permanently.
        const result = renderBadgeIds([]);

        expect(result.current.linkedPerfRuns.size).toBe(0);
        expect(result.current.unlinkedPerfRuns.size).toBe(0);
        expect(result.current.linkedProfilerReportRuns.size).toBe(0);
        expect(result.current.unlinkedProfilerReportRuns.size).toBe(0);
    });

    it('separates linked from unlinked counterparts of the active reports', () => {
        const result = renderBadgeIds([
            link({ performanceId: 'perf-linked' }),
            link({ performanceId: 'perf-unlinked', status: ReportPairLinkStatus.UNLINKED }),
            // A different profiler report, so neither set should pick it up.
            link({ profilerId: 'other-run', performanceId: 'perf-elsewhere' }),
        ]);

        expect(idsOf(result.current.linkedPerfRuns)).toEqual(new Set(['perf-linked']));
        expect(idsOf(result.current.unlinkedPerfRuns)).toEqual(new Set(['perf-unlinked']));
    });

    it('resolves counterparts of the active performance report as well', () => {
        const result = renderBadgeIds([
            link({ profilerId: 'mem-linked' }),
            link({ profilerId: 'mem-unlinked', status: ReportPairLinkStatus.UNLINKED }),
        ]);

        expect(idsOf(result.current.linkedProfilerReportRuns)).toEqual(new Set(['mem-linked']));
        expect(idsOf(result.current.unlinkedProfilerReportRuns)).toEqual(new Set(['mem-unlinked']));
    });

    it('scopes out counterparts recorded against another remote host', () => {
        const links = [
            link({
                performanceId: 'perf-here',
                performanceAccess: { location: ReportLocation.REMOTE, path: '/r/perf-here', host: 'n150' },
            }),
            link({
                performanceId: 'perf-elsewhere',
                performanceAccess: { location: ReportLocation.REMOTE, path: '/r/perf-elsewhere', host: 'n300' },
            }),
            // Local links stay visible so a report synced from one host can still be
            // paired with a locally loaded one.
            link({
                performanceId: 'perf-local',
                performanceAccess: { location: ReportLocation.LOCAL, path: '/data/perf-local' },
            }),
        ];

        expect(idsOf(renderBadgeIds(links, 'n150').current.linkedPerfRuns)).toEqual(
            new Set(['perf-here', 'perf-local']),
        );
        // No host scope (the local picker) keeps every counterpart.
        expect(idsOf(renderBadgeIds(links).current.linkedPerfRuns)).toEqual(
            new Set(['perf-here', 'perf-elsewhere', 'perf-local']),
        );
    });

    it('drops links recorded against another run of the active folder', () => {
        activeRunsState.data = { profiler: 'v1:mem-new', performance: null };

        const result = renderBadgeIds([
            link({ performanceId: 'perf-old', profilerRun: 'v1:mem-old' }),
            link({ performanceId: 'perf-new', profilerRun: 'v1:mem-new' }),
            link({ performanceId: 'perf-legacy' }),
        ]);

        expect(idsOf(result.current.linkedPerfRuns)).toEqual(new Set(['perf-new', 'perf-legacy']));
    });

    it('keeps every link until the active runs load', () => {
        const result = renderBadgeIds([
            link({ performanceId: 'perf-old', profilerRun: 'v1:mem-old' }),
            link({ performanceId: 'perf-new', profilerRun: 'v1:mem-new' }),
        ]);

        expect(idsOf(result.current.linkedPerfRuns)).toEqual(new Set(['perf-old', 'perf-new']));
    });
});
