// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect } from 'react';
import useRemoteConnection from './useRemote';
import { useReportLinkMatch } from './useReportLinkMatch';
import {
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    performanceReportLocationAtom,
    profilerReportLocationAtom,
    reportLinksAtom,
} from '../store/app';
import {
    ReportLinkMatchResult,
    ReportPairLinkStatus,
    getReportIdentity,
    upsertReportLink,
} from '../functions/reportLinks';
import getServerConfig from '../functions/getServerConfig';
import { ReportLocation } from '../definitions/Reports';

const resolveHost = (
    location: ReportLocation | null,
    reportHost: string | null | undefined,
    fallbackHost: string | null,
): string | null => {
    if (location !== ReportLocation.REMOTE) {
        return null;
    }

    return reportHost ?? fallbackHost;
};

/**
 * Persists LINKED / UNLINKED outcomes for the active memory↔performance pair.
 * Mount once near the app shell (e.g. FooterInfobar) — not inside the status icon.
 */
const useRecordReportLink = (): void => {
    const matchResult = useReportLinkMatch();
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const profilerLocation = useAtomValue(profilerReportLocationAtom);
    const performanceLocation = useAtomValue(performanceReportLocationAtom);
    const setReportLinks = useSetAtom(reportLinksAtom);

    const { persistentState } = useRemoteConnection();
    const isReportLinkingEnabled = !!getServerConfig()?.REPORT_LINKING_ENABLED;
    // Avoid useInstance here — its queryKey includes active report paths and would
    // couple link persistence to instance refetch churn.
    const fallbackRemoteHost = persistentState.selectedConnection?.host ?? null;

    useEffect(() => {
        if (
            !isReportLinkingEnabled ||
            !activeProfilerReport ||
            !activePerformanceReport ||
            !profilerLocation ||
            !performanceLocation
        ) {
            return;
        }

        if (matchResult !== ReportLinkMatchResult.LINKED && matchResult !== ReportLinkMatchResult.UNLINKED) {
            return;
        }

        const profilerHost = resolveHost(profilerLocation, activeProfilerReport.host, fallbackRemoteHost);
        const performanceHost = resolveHost(performanceLocation, activePerformanceReport.host, fallbackRemoteHost);

        if (
            (profilerLocation === ReportLocation.REMOTE && !profilerHost) ||
            (performanceLocation === ReportLocation.REMOTE && !performanceHost)
        ) {
            return;
        }

        const profilerIdentity = getReportIdentity({ ...activeProfilerReport, host: profilerHost }, profilerLocation);
        const performanceIdentity = getReportIdentity(
            { ...activePerformanceReport, host: performanceHost },
            performanceLocation,
        );

        const pair = {
            profilerPath: profilerIdentity.path,
            profilerLocation: profilerIdentity.location,
            profilerHost: profilerIdentity.host,
            performancePath: performanceIdentity.path,
            performanceLocation: performanceIdentity.location,
            performanceHost: performanceIdentity.host,
            status:
                matchResult === ReportLinkMatchResult.LINKED
                    ? ReportPairLinkStatus.LINKED
                    : ReportPairLinkStatus.UNLINKED,
            recordedAt: Date.now(),
        };

        setReportLinks((links) => upsertReportLink(links, pair));
    }, [
        matchResult,
        activeProfilerReport,
        activePerformanceReport,
        profilerLocation,
        performanceLocation,
        fallbackRemoteHost,
        setReportLinks,
        isReportLinkingEnabled,
    ]);
};

export default useRecordReportLink;
