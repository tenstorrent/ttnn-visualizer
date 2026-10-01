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
    ReportLinkMatchResult,
} from '../src/definitions/ReportLinks';
import { TEST_IDS } from '../src/definitions/TestIds';
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

const matchState = vi.hoisted(() => ({
    result: 'pending' as string,
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

        fireEvent.mouseEnter(screen.getByTestId(TEST_IDS.REPORT_LINK_STATUS));

        expect(await screen.findByText(REPORTS_LINKED_TOOLTIP)).toBeInTheDocument();
        expect(screen.queryByText(REPORTS_UNLINKED_TOOLTIP, { exact: false })).not.toBeInTheDocument();
    });

    it('tells the user the reports could not be linked when they do not match', async () => {
        matchState.result = ReportLinkMatchResult.UNLINKED;
        renderWithReports();

        fireEvent.mouseEnter(screen.getByTestId(TEST_IDS.REPORT_LINK_STATUS));

        // The hint shares the element after a <br />, so match the headline as a substring.
        expect(await screen.findByText(REPORTS_UNLINKED_TOOLTIP, { exact: false })).toBeInTheDocument();
        expect(screen.queryByText(REPORTS_LINKED_TOOLTIP)).not.toBeInTheDocument();
    });

    // Persistence lives in `usePersistReportLinks`, mounted from `Layout`, so the icon can
    // be moved or hidden without silently stopping link recording.
    it('does not persist a settled match itself', () => {
        matchState.result = ReportLinkMatchResult.LINKED;
        renderWithReports();

        expect(getProbedReportLinks()).toEqual([]);
    });
});
