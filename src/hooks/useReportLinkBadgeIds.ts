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
    linkedPerfIds: Set<string> | null;
    unlinkedPerfIds: Set<string> | null;
    linkedProfilerReportIds: Set<string> | null;
    unlinkedProfilerReportIds: Set<string> | null;
}

/**
 * Linked / unlinked counterpart ids for folder pickers. When linking is disabled,
 * all sets are null so pickers hide badges. Pass `remoteHost` from the remote
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

    return useMemo(() => {
        if (!isReportLinkingEnabled) {
            return {
                linkedPerfIds: null,
                unlinkedPerfIds: null,
                linkedProfilerReportIds: null,
                unlinkedProfilerReportIds: null,
            };
        }

        return {
            linkedPerfIds: linkedPerformanceIds(reportLinks, profilerId, { remoteHost }),
            unlinkedPerfIds: unlinkedPerformanceIds(reportLinks, profilerId, { remoteHost }),
            linkedProfilerReportIds: linkedProfilerIds(reportLinks, performanceId, { remoteHost }),
            unlinkedProfilerReportIds: unlinkedProfilerIds(reportLinks, performanceId, { remoteHost }),
        };
    }, [reportLinks, profilerId, performanceId, isReportLinkingEnabled, remoteHost]);
};
