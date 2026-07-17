// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import useRemoteConnection from './useRemote';
import {
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    performanceReportLocationAtom,
    profilerReportLocationAtom,
    reportLinksAtom,
} from '../store/app';
import {
    linkedPerformancePaths,
    linkedProfilerPaths,
    unlinkedPerformancePaths,
    unlinkedProfilerPaths,
} from '../functions/reportLinks';
import getServerConfig from '../functions/getServerConfig';
import { ReportLocation } from '../definitions/Reports';

export enum ReportLinkListScope {
    LOCAL = 'local',
    REMOTE = 'remote',
}

export interface ReportLinkBadgePaths {
    linkedPerfPaths: Set<string> | undefined;
    unlinkedPerfPaths: Set<string> | undefined;
    linkedProfilerPaths: Set<string> | undefined;
    unlinkedProfilerPaths: Set<string> | undefined;
}

/**
 * Badge path sets for report pickers. `listScope` controls counterpart-host
 * filtering: local lists only surface local partners; remote lists only partners
 * on the selected SSH host.
 */
const useReportLinkBadges = (listScope: ReportLinkListScope): ReportLinkBadgePaths => {
    const isReportLinkingEnabled = !!getServerConfig()?.REPORT_LINKING_ENABLED;
    const reportLinks = useAtomValue(reportLinksAtom);
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const profilerReportLocation = useAtomValue(profilerReportLocationAtom);
    const performanceReportLocation = useAtomValue(performanceReportLocationAtom);
    const { persistentState } = useRemoteConnection();

    const selectedRemoteHost = persistentState.selectedConnection?.host ?? null;
    const counterpartHost = listScope === ReportLinkListScope.LOCAL ? null : selectedRemoteHost;

    const activeProfilerHost =
        activeProfilerReport?.host ?? (profilerReportLocation === ReportLocation.REMOTE ? selectedRemoteHost : null);
    const activePerformanceHost =
        activePerformanceReport?.host ??
        (performanceReportLocation === ReportLocation.REMOTE ? selectedRemoteHost : null);

    return useMemo(() => {
        if (!isReportLinkingEnabled) {
            return {
                linkedPerfPaths: undefined,
                unlinkedPerfPaths: undefined,
                linkedProfilerPaths: undefined,
                unlinkedProfilerPaths: undefined,
            };
        }

        return {
            linkedPerfPaths: linkedPerformancePaths(
                reportLinks,
                activeProfilerReport?.path,
                profilerReportLocation,
                activeProfilerHost,
                counterpartHost,
            ),
            unlinkedPerfPaths: unlinkedPerformancePaths(
                reportLinks,
                activeProfilerReport?.path,
                profilerReportLocation,
                activeProfilerHost,
                counterpartHost,
            ),
            linkedProfilerPaths: linkedProfilerPaths(
                reportLinks,
                activePerformanceReport?.path,
                performanceReportLocation,
                activePerformanceHost,
                counterpartHost,
            ),
            unlinkedProfilerPaths: unlinkedProfilerPaths(
                reportLinks,
                activePerformanceReport?.path,
                performanceReportLocation,
                activePerformanceHost,
                counterpartHost,
            ),
        };
    }, [
        isReportLinkingEnabled,
        reportLinks,
        activeProfilerReport,
        activePerformanceReport,
        profilerReportLocation,
        performanceReportLocation,
        activeProfilerHost,
        activePerformanceHost,
        counterpartHost,
    ]);
};

export default useReportLinkBadges;
