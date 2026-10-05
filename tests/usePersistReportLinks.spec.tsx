// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSetAtom } from 'jotai';
import ReportLinkRecorder from '../src/components/ReportLinkRecorder';
import { ReportFolder, ReportLocation } from '../src/definitions/Reports';
import { ReportLinkMatchResult, ReportPairLinkStatus } from '../src/definitions/ReportLinks';
import {
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    performanceReportLocationAtom,
    profilerReportLocationAtom,
    reportLinksAtom,
    tracingModeAtom,
} from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';
import { ReportLinksProbe } from './helpers/ReportLinksProbe';
import { PERFORMANCE_REPORT, PROFILER_REPORT, getProbedReportLinks } from './helpers/reportLinkFixtures';

// Seeded in `beforeEach`: the enum isn't importable yet when `vi.hoisted` runs.
const matchState = vi.hoisted(() => ({
    result: null as ReportLinkMatchResult | null,
}));

vi.mock('../src/hooks/useReportLinkMatch', () => ({
    useReportLinkMatch: () => matchState.result,
}));

vi.mock('../src/hooks/useRemote', () => ({
    default: () => ({
        persistentState: { selectedConnection: { host: 'n150' } },
    }),
}));

const CLEAR_REPORT_LINKS_LABEL = 'Clear report links';

// Writes `reportLinksAtom` from outside the recorder, as a delete's prune does.
function ReportLinksClearer() {
    const setReportLinks = useSetAtom(reportLinksAtom);

    return (
        <button
            type='button'
            onClick={() => setReportLinks([])}
        >
            {CLEAR_REPORT_LINKS_LABEL}
        </button>
    );
}

interface RenderOptions {
    tracingMode?: boolean;
    profiler?: ReportFolder;
    profilerLocation?: ReportLocation;
    performance?: ReportFolder | null;
}

// Built separately from `render` so a case can `rerender` the same tree, keeping the store.
function reportsTree({
    tracingMode = false,
    profiler = PROFILER_REPORT,
    profilerLocation = ReportLocation.LOCAL,
    performance = PERFORMANCE_REPORT,
}: RenderOptions = {}) {
    return (
        <TestProviders
            initialAtomValues={[
                [activeProfilerReportAtom, profiler],
                [activePerformanceReportAtom, performance],
                [profilerReportLocationAtom, profilerLocation],
                [performanceReportLocationAtom, ReportLocation.LOCAL],
                [reportLinksAtom, []],
                [tracingModeAtom, tracingMode],
            ]}
        >
            <ReportLinkRecorder />
            <ReportLinksClearer />
            <ReportLinksProbe />
        </TestProviders>
    );
}

const renderWithReports = (options?: RenderOptions) => render(reportsTree(options));

describe('usePersistReportLinks', () => {
    beforeEach(() => {
        window.localStorage.clear();
        matchState.result = ReportLinkMatchResult.PENDING;
    });

    afterEach(() => {
        cleanup();
        window.localStorage.clear();
    });

    // `render` flushes effects inside `act` and the match is mocked synchronously, so the
    // probe is final once `render` returns; a `waitFor` would pass on its first attempt.
    it('does not persist while match is PENDING', () => {
        matchState.result = ReportLinkMatchResult.PENDING;
        renderWithReports();

        expect(getProbedReportLinks()).toEqual([]);
    });

    it('does not persist when match is UNAVAILABLE', () => {
        matchState.result = ReportLinkMatchResult.UNAVAILABLE;
        renderWithReports();

        expect(getProbedReportLinks()).toEqual([]);
    });

    // Positive control for the two cases above: same store, so an empty probe there
    // means "not yet", not "this harness can never record".
    it('persists once a PENDING match settles to LINKED', () => {
        matchState.result = ReportLinkMatchResult.PENDING;
        const { rerender } = renderWithReports();
        expect(getProbedReportLinks()).toEqual([]);

        matchState.result = ReportLinkMatchResult.LINKED;
        rerender(reportsTree());

        expect(getProbedReportLinks()).toMatchObject([{ status: ReportPairLinkStatus.LINKED }]);
    });

    // A delete prunes the active pair while the match still reads LINKED. If the recorder
    // re-ran on `reportLinksAtom`, it would write the pair straight back.
    it('does not re-record a pair removed from outside while the match is unchanged', () => {
        matchState.result = ReportLinkMatchResult.LINKED;
        renderWithReports();
        expect(getProbedReportLinks()).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: CLEAR_REPORT_LINKS_LABEL }));

        expect(getProbedReportLinks()).toEqual([]);
    });

    // Mounted via `ReportLinkRecorder` in `Layout`, the hook runs on every route, including ones with one report.
    it('does not persist without both active reports', () => {
        matchState.result = ReportLinkMatchResult.LINKED;
        renderWithReports({ performance: null });

        expect(getProbedReportLinks()).toEqual([]);
    });

    // UNLINKED is persisted too, so pickers can badge failed links.
    it.each([
        [ReportLinkMatchResult.LINKED, ReportPairLinkStatus.LINKED],
        [ReportLinkMatchResult.UNLINKED, ReportPairLinkStatus.UNLINKED],
    ])('persists a %s match once the comparison settles', (result, status) => {
        matchState.result = result;
        renderWithReports();

        expect(getProbedReportLinks()).toMatchObject([{ profilerId: 'mem-run', performanceId: 'perf-run', status }]);
    });

    // Pruning on delete derives the id the same way, so this is half of a shared contract:
    // if recording stopped preferring syncedName, deletes would silently stop pruning.
    it('keys a synced report by its syncedName rather than its path', () => {
        matchState.result = ReportLinkMatchResult.LINKED;
        renderWithReports({
            profiler: {
                path: '/data/local/profiler-reports/local-copy',
                reportName: 'local-copy',
                syncedName: 'remote-run',
            },
        });

        expect(getProbedReportLinks()).toMatchObject([{ profilerId: 'remote-run', performanceId: 'perf-run' }]);
    });

    // The remote picker's host scoping reads `host`, so a host on the wrong side would
    // badge reports from one remote machine as linked on another.
    it('records the remote host only on the remote side', () => {
        matchState.result = ReportLinkMatchResult.LINKED;
        renderWithReports({ profilerLocation: ReportLocation.REMOTE });

        expect(getProbedReportLinks()).toMatchObject([
            {
                profilerAccess: { location: ReportLocation.REMOTE, path: PROFILER_REPORT.path, host: 'n150' },
                performanceAccess: { location: ReportLocation.LOCAL, path: PERFORMANCE_REPORT.path, host: null },
            },
        ]);
    });

    // Link resolution pins tracing mode off (#1812), so a verdict reached with the
    // toggle on describes the reports just as one reached with it off does. This
    // used to be suppressed, on the since-disproved premise that the toggle changed
    // the row order the match ran against. Kept as the guard against that carve-out
    // being reintroduced: it is the only case that would fail if `usePersistReportLinks`
    // started reading `tracingModeAtom` again.
    it('persists an UNLINKED reached with tracing mode on', () => {
        matchState.result = ReportLinkMatchResult.UNLINKED;
        renderWithReports({ tracingMode: true });

        expect(getProbedReportLinks()).toMatchObject([{ status: ReportPairLinkStatus.UNLINKED }]);
    });
});
