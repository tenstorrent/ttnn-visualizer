// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ReportPairLinkStatus } from '../src/definitions/ReportLinks';
import { ReportLocation } from '../src/definitions/Reports';
import { useReportLinkBadgeIds } from '../src/hooks/useReportLinkBadgeIds';
import type { ReportLink } from '../src/model/ReportLinks';
import { activePerformanceReportAtom, activeProfilerReportAtom, reportLinksAtom } from '../src/store/app';
import { AtomProvider, type AtomProviderInitialValues } from './helpers/atomProvider';

const PROFILER = { path: '/data/local/profiler-reports/mem-run', reportName: 'mem-run' };
const PERFORMANCE = { path: '/data/local/performance-reports/perf-run', reportName: 'perf-run' };

function link(overrides: Partial<ReportLink>): ReportLink {
    return {
        profilerId: 'mem-run',
        performanceId: 'perf-run',
        status: ReportPairLinkStatus.LINKED,
        recordedAt: 0,
        ...overrides,
    };
}

function renderBadgeIds(links: ReportLink[], remoteHost?: string | null) {
    const initialValues = [
        [reportLinksAtom, links],
        [activeProfilerReportAtom, PROFILER],
        [activePerformanceReportAtom, PERFORMANCE],
    ] as AtomProviderInitialValues;

    return renderHook(() => useReportLinkBadgeIds(remoteHost === undefined ? undefined : { remoteHost }), {
        wrapper: ({ children }: { children: ReactNode }) => (
            <AtomProvider initialValues={initialValues}>{children}</AtomProvider>
        ),
    }).result;
}

describe('useReportLinkBadgeIds', () => {
    it('returns empty sets rather than null when nothing is linked', () => {
        // Not null: the hook previously returned null throughout while report linking was
        // gated off, and a picker treating "no badges yet" as "badges unavailable" would
        // hide them permanently.
        const result = renderBadgeIds([]);

        expect(result.current.linkedPerfIds).toEqual(new Set());
        expect(result.current.unlinkedPerfIds).toEqual(new Set());
        expect(result.current.linkedProfilerReportIds).toEqual(new Set());
        expect(result.current.unlinkedProfilerReportIds).toEqual(new Set());
    });

    it('separates linked from unlinked counterparts of the active reports', () => {
        const result = renderBadgeIds([
            link({ performanceId: 'perf-linked' }),
            link({ performanceId: 'perf-unlinked', status: ReportPairLinkStatus.UNLINKED }),
            // A different profiler report, so neither set should pick it up.
            link({ profilerId: 'other-run', performanceId: 'perf-elsewhere' }),
        ]);

        expect(result.current.linkedPerfIds).toEqual(new Set(['perf-linked']));
        expect(result.current.unlinkedPerfIds).toEqual(new Set(['perf-unlinked']));
    });

    it('resolves counterparts of the active performance report as well', () => {
        const result = renderBadgeIds([
            link({ profilerId: 'mem-linked' }),
            link({ profilerId: 'mem-unlinked', status: ReportPairLinkStatus.UNLINKED }),
        ]);

        expect(result.current.linkedProfilerReportIds).toEqual(new Set(['mem-linked']));
        expect(result.current.unlinkedProfilerReportIds).toEqual(new Set(['mem-unlinked']));
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

        expect(renderBadgeIds(links, 'n150').current.linkedPerfIds).toEqual(new Set(['perf-here', 'perf-local']));
        // No host scope (the local picker) keeps every counterpart.
        expect(renderBadgeIds(links).current.linkedPerfIds).toEqual(
            new Set(['perf-here', 'perf-elsewhere', 'perf-local']),
        );
    });
});
