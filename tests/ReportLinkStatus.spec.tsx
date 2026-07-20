// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReportLinkStatus from '../src/components/ReportLinkStatus';
import { ReportLocation } from '../src/definitions/Reports';
import { ReportLinkMatchResult, ReportPairLinkStatus } from '../src/functions/reportLinks';
import {
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    performanceReportLocationAtom,
    profilerReportLocationAtom,
    reportLinksAtom,
} from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';

const matchState = vi.hoisted(() => ({
    result: 'pending' as string,
}));

vi.mock('../src/hooks/useReportLinkMatch', () => ({
    useReportLinkMatch: () => matchState.result,
}));

vi.mock('../src/hooks/useRemote', () => ({
    default: () => ({
        persistentState: { selectedConnection: { host: 'n150' } },
    }),
}));

vi.mock('../src/functions/getServerConfig', () => ({
    default: () => ({ REPORT_LINKING_ENABLED: true }),
}));

const PROFILER = { path: '/data/local/profiler-reports/mem-run', reportName: 'mem-run' };
const PERFORMANCE = { path: '/data/local/performance-reports/perf-run', reportName: 'perf-run' };

function LinksProbe() {
    const links = useAtomValue(reportLinksAtom);

    return <pre data-testid='report-links'>{JSON.stringify(links)}</pre>;
}

function renderWithReports() {
    return render(
        <TestProviders
            initialAtomValues={[
                [activeProfilerReportAtom, PROFILER],
                [activePerformanceReportAtom, PERFORMANCE],
                [profilerReportLocationAtom, ReportLocation.LOCAL],
                [performanceReportLocationAtom, ReportLocation.LOCAL],
                [reportLinksAtom, []],
            ]}
        >
            <ReportLinkStatus />
            <LinksProbe />
        </TestProviders>,
    );
}

describe('ReportLinkStatus', () => {
    beforeEach(() => {
        window.localStorage.clear();
        matchState.result = ReportLinkMatchResult.PENDING;
    });

    afterEach(() => {
        cleanup();
        window.localStorage.clear();
    });

    it('does not persist while match is PENDING', async () => {
        matchState.result = ReportLinkMatchResult.PENDING;
        renderWithReports();

        await waitFor(() => {
            expect(JSON.parse(screen.getByTestId('report-links').textContent ?? '[]')).toEqual([]);
        });
    });

    it('does not persist when match is UNAVAILABLE', async () => {
        matchState.result = ReportLinkMatchResult.UNAVAILABLE;
        renderWithReports();

        await waitFor(() => {
            expect(JSON.parse(screen.getByTestId('report-links').textContent ?? '[]')).toEqual([]);
        });
    });

    it('persists a LINKED pair once the comparison settles', async () => {
        matchState.result = ReportLinkMatchResult.LINKED;
        renderWithReports();

        await waitFor(() => {
            const links = JSON.parse(screen.getByTestId('report-links').textContent ?? '[]');
            expect(links).toHaveLength(1);
            expect(links[0]).toMatchObject({
                profilerId: 'mem-run',
                performanceId: 'perf-run',
                status: ReportPairLinkStatus.LINKED,
            });
        });
    });

    it('persists an UNLINKED pair so pickers can badge failed links', async () => {
        matchState.result = ReportLinkMatchResult.UNLINKED;
        renderWithReports();

        await waitFor(() => {
            const links = JSON.parse(screen.getByTestId('report-links').textContent ?? '[]');
            expect(links).toHaveLength(1);
            expect(links[0]).toMatchObject({
                profilerId: 'mem-run',
                performanceId: 'perf-run',
                status: ReportPairLinkStatus.UNLINKED,
            });
        });
    });
});
