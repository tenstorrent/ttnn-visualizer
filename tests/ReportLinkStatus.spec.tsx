// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReportLinkStatus from '../src/components/ReportLinkStatus';
import { ReportLocation } from '../src/definitions/Reports';
import {
    REPORTS_LINKED_TOOLTIP,
    REPORTS_UNLINKED_TOOLTIP,
    REPORTS_UNLINKED_TOOLTIP_HINT,
    ReportLinkMatchResult,
} from '../src/definitions/ReportLinks';
import {
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    performanceReportLocationAtom,
    profilerReportLocationAtom,
    reportLinksAtom,
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

function renderWithReports() {
    return render(
        <TestProviders
            initialAtomValues={[
                [activeProfilerReportAtom, PROFILER_REPORT],
                [activePerformanceReportAtom, PERFORMANCE_REPORT],
                [profilerReportLocationAtom, ReportLocation.LOCAL],
                [performanceReportLocationAtom, ReportLocation.LOCAL],
                [reportLinksAtom, []],
            ]}
        >
            <ReportLinkStatus />
            <ReportLinksProbe />
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

    it('tells the user the reports are linked when they match', async () => {
        matchState.result = ReportLinkMatchResult.LINKED;
        renderWithReports();

        fireEvent.mouseEnter(screen.getByRole('img', { name: REPORTS_LINKED_TOOLTIP }));

        expect(await screen.findByText(REPORTS_LINKED_TOOLTIP)).toBeInTheDocument();
        expect(screen.queryByText(REPORTS_UNLINKED_TOOLTIP, { exact: false })).not.toBeInTheDocument();
    });

    it('tells the user the reports could not be linked when they do not match', async () => {
        matchState.result = ReportLinkMatchResult.UNLINKED;
        renderWithReports();

        fireEvent.mouseEnter(screen.getByRole('img', { name: REPORTS_UNLINKED_TOOLTIP }));

        // The hint shares the element after a <br />, so match each line as a substring.
        expect(await screen.findByText(REPORTS_UNLINKED_TOOLTIP, { exact: false })).toBeInTheDocument();
        expect(screen.getByText(REPORTS_UNLINKED_TOOLTIP_HINT, { exact: false })).toBeInTheDocument();
        expect(screen.queryByText(REPORTS_LINKED_TOOLTIP)).not.toBeInTheDocument();
    });

    // Persistence lives in `usePersistReportLinks`, mounted via `ReportLinkRecorder` in
    // `Layout`, so the icon can be moved or hidden without silently stopping link recording.
    it('does not persist a settled match itself', () => {
        matchState.result = ReportLinkMatchResult.LINKED;
        renderWithReports();

        expect(getProbedReportLinks()).toEqual([]);
    });
});
