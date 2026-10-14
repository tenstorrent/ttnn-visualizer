// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { ReportLinkMatchResult, ReportPairLinkStatus } from '../definitions/ReportLinks';
import {
    createReportLinkAccess,
    getFolderReportId,
    isSettledLinkMatch,
    upsertReportLink,
} from '../functions/reportLinks';
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
    const selectedHost = persistentState.selectedConnection?.host ?? null;

    // Read through a ref so picking another connection alone does not re-record: the
    // dropdown's choice can change while the active reports still came from the old host.
    // Declared first, so it updates before the recording effect in the same commit.
    const remoteHostRef = useRef(selectedHost);
    useEffect(() => {
        remoteHostRef.current = selectedHost;
    }, [selectedHost]);

    useEffect(() => {
        if (!activeProfilerReport || !activePerformanceReport || !profilerLocation || !performanceLocation) {
            return;
        }

        if (!isSettledLinkMatch(matchResult)) {
            return;
        }

        const profilerId = getFolderReportId(activeProfilerReport);
        const performanceId = getFolderReportId(activePerformanceReport);

        if (!profilerId || !performanceId) {
            return;
        }

        const remoteHost = remoteHostRef.current;

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
    ]);
}
