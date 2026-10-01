// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { ReportLinkMatchResult, ReportPairLinkStatus } from '../definitions/ReportLinks';
import { createReportLinkAccess, getReportId, upsertReportLink } from '../functions/reportLinks';
import useRemoteConnection from './useRemote';
import { useReportLinkMatch } from './useReportLinkMatch';
import {
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    performanceReportLocationAtom,
    profilerReportLocationAtom,
    reportLinksAtom,
} from '../store/app';

/**
 * Persist LINKED / UNLINKED once the live comparison settles so pickers can badge
 * known counterparts (including failed pairs). Mounted once, by `ReportLinkRecorder` in
 * `Layout`, rather than from the footer's link icon, so moving or hiding that icon cannot
 * stop recording.
 */
export default function usePersistReportLinks(): void {
    const matchResult = useReportLinkMatch();
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const profilerLocation = useAtomValue(profilerReportLocationAtom);
    const performanceLocation = useAtomValue(performanceReportLocationAtom);
    const setReportLinks = useSetAtom(reportLinksAtom);
    const { persistentState } = useRemoteConnection();

    useEffect(() => {
        if (!activeProfilerReport || !activePerformanceReport || !profilerLocation || !performanceLocation) {
            return;
        }

        if (matchResult !== ReportLinkMatchResult.LINKED && matchResult !== ReportLinkMatchResult.UNLINKED) {
            return;
        }

        const profilerId = getReportId(activeProfilerReport.syncedName, activeProfilerReport.path);
        const performanceId = getReportId(activePerformanceReport.syncedName, activePerformanceReport.path);

        if (!profilerId || !performanceId) {
            return;
        }

        const remoteHost = persistentState.selectedConnection?.host ?? null;

        setReportLinks((links) =>
            upsertReportLink(links, {
                profilerId,
                performanceId,
                status:
                    matchResult === ReportLinkMatchResult.LINKED
                        ? ReportPairLinkStatus.LINKED
                        : ReportPairLinkStatus.UNLINKED,
                recordedAt: Date.now(),
                profilerAccess: createReportLinkAccess(profilerLocation, activeProfilerReport.path, remoteHost),
                performanceAccess: createReportLinkAccess(
                    performanceLocation,
                    activePerformanceReport.path,
                    remoteHost,
                ),
            }),
        );
    }, [
        matchResult,
        activeProfilerReport,
        activePerformanceReport,
        profilerLocation,
        performanceLocation,
        setReportLinks,
        persistentState.selectedConnection?.host,
    ]);
}
