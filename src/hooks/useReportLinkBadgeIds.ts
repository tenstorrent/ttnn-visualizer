// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import getServerConfig from '../functions/getServerConfig';
import {
    LinkedReportIdOptions,
    getReportId,
    linkedPerformanceIds,
    linkedProfilerIds,
    unlinkedPerformanceIds,
    unlinkedProfilerIds,
} from '../functions/reportLinks';
import { activePerformanceReportAtom, activeProfilerReportAtom, reportLinksAtom } from '../store/app';

export interface ReportLinkBadgeIds {
    linkedPerfIds: Set<string> | undefined;
    unlinkedPerfIds: Set<string> | undefined;
    linkedProfilerReportIds: Set<string> | undefined;
    unlinkedProfilerReportIds: Set<string> | undefined;
}

/**
 * Linked / unlinked counterpart ids for folder pickers. When linking is disabled,
 * all sets are undefined so pickers hide badges. Pass `remoteHost` from the remote
 * picker so counterparts recorded only against another host are scoped out.
 */
export const useReportLinkBadgeIds = (options?: LinkedReportIdOptions): ReportLinkBadgeIds => {
    const reportLinks = useAtomValue(reportLinksAtom);
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const isReportLinkingEnabled = !!getServerConfig()?.REPORT_LINKING_ENABLED;
    const remoteHost = options?.remoteHost ?? null;

    const profilerId = getReportId(activeProfilerReport?.path, activeProfilerReport?.reportName);
    const performanceId = getReportId(activePerformanceReport?.path, activePerformanceReport?.reportName);

    const linkedPerfIds = useMemo(
        () => (isReportLinkingEnabled ? linkedPerformanceIds(reportLinks, profilerId, { remoteHost }) : undefined),
        [reportLinks, profilerId, isReportLinkingEnabled, remoteHost],
    );
    const unlinkedPerfIds = useMemo(
        () => (isReportLinkingEnabled ? unlinkedPerformanceIds(reportLinks, profilerId, { remoteHost }) : undefined),
        [reportLinks, profilerId, isReportLinkingEnabled, remoteHost],
    );
    const linkedProfilerReportIds = useMemo(
        () => (isReportLinkingEnabled ? linkedProfilerIds(reportLinks, performanceId, { remoteHost }) : undefined),
        [reportLinks, performanceId, isReportLinkingEnabled, remoteHost],
    );
    const unlinkedProfilerReportIds = useMemo(
        () => (isReportLinkingEnabled ? unlinkedProfilerIds(reportLinks, performanceId, { remoteHost }) : undefined),
        [reportLinks, performanceId, isReportLinkingEnabled, remoteHost],
    );

    return { linkedPerfIds, unlinkedPerfIds, linkedProfilerReportIds, unlinkedProfilerReportIds };
};
