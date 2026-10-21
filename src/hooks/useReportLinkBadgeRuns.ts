// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { LinkedReportIdOptions, ReportLinkRunsById } from '../definitions/ReportLinks';
import {
    getFolderReportId,
    linkedPerformanceRuns,
    linkedProfilerRuns,
    unlinkedPerformanceRuns,
    unlinkedProfilerRuns,
} from '../functions/reportLinks';
import { activePerformanceReportAtom, activeProfilerReportAtom, reportLinksAtom } from '../store/app';
import { useActiveReportFingerprints } from './useAPI';

export interface ReportLinkBadgeRuns {
    linkedPerfRuns: ReportLinkRunsById;
    unlinkedPerfRuns: ReportLinkRunsById;
    linkedProfilerReportRuns: ReportLinkRunsById;
    unlinkedProfilerReportRuns: ReportLinkRunsById;
}

/**
 * Linked / unlinked counterparts of the active reports for folder pickers, keyed by
 * counterpart id. Only links recorded against the run each active folder holds now
 * count; a picker row then checks its own run with `getFolderLinkState`. Until the
 * active runs load, every link counts, as before #2069. Pass `remoteHost` from the
 * remote picker so counterparts recorded only against another host are scoped out.
 */
export const useReportLinkBadgeRuns = (options?: Pick<LinkedReportIdOptions, 'remoteHost'>): ReportLinkBadgeRuns => {
    const reportLinks = useAtomValue(reportLinksAtom);
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const { data: activeRuns } = useActiveReportFingerprints();
    const remoteHost = options?.remoteHost ?? null;

    const profilerId = getFolderReportId(activeProfilerReport);
    const performanceId = getFolderReportId(activePerformanceReport);
    const profilerRun = activeRuns?.profiler ?? null;
    const performanceRun = activeRuns?.performance ?? null;

    return useMemo(() => {
        const profilerOptions = { remoteHost, activeRun: profilerRun };
        const performanceOptions = { remoteHost, activeRun: performanceRun };

        return {
            linkedPerfRuns: linkedPerformanceRuns(reportLinks, profilerId, profilerOptions),
            unlinkedPerfRuns: unlinkedPerformanceRuns(reportLinks, profilerId, profilerOptions),
            linkedProfilerReportRuns: linkedProfilerRuns(reportLinks, performanceId, performanceOptions),
            unlinkedProfilerReportRuns: unlinkedProfilerRuns(reportLinks, performanceId, performanceOptions),
        };
    }, [reportLinks, profilerId, performanceId, profilerRun, performanceRun, remoteHost]);
};
