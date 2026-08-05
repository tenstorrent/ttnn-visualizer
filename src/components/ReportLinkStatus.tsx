// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Icon, Intent, Position, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { ReportLocation } from '../definitions/Reports';
import { ReportLinkMatchResult, ReportPairLinkStatus } from '../definitions/ReportLinks';
import { getReportId, upsertReportLink } from '../functions/reportLinks';
import getServerConfig from '../functions/getServerConfig';
import useRemoteConnection from '../hooks/useRemote';
import { useReportLinkMatch } from '../hooks/useReportLinkMatch';
import {
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    performanceReportLocationAtom,
    profilerReportLocationAtom,
    reportLinksAtom,
} from '../store/app';

const ReportLinkStatus = () => {
    const matchResult = useReportLinkMatch();
    const isLinked = matchResult === ReportLinkMatchResult.LINKED;

    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const profilerLocation = useAtomValue(profilerReportLocationAtom);
    const performanceLocation = useAtomValue(performanceReportLocationAtom);
    const setReportLinks = useSetAtom(reportLinksAtom);
    const { persistentState } = useRemoteConnection();

    const isReportLinkingEnabled = !!getServerConfig()?.REPORT_LINKING_ENABLED;

    // Persist LINKED / UNLINKED once the live comparison settles so pickers can
    // badge known counterparts (including failed pairs).
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
                profilerAccess: {
                    location: profilerLocation,
                    path: activeProfilerReport.path,
                    host: profilerLocation === ReportLocation.REMOTE ? remoteHost : null,
                },
                performanceAccess: {
                    location: performanceLocation,
                    path: activePerformanceReport.path,
                    host: performanceLocation === ReportLocation.REMOTE ? remoteHost : null,
                },
            }),
        );
    }, [
        matchResult,
        activeProfilerReport,
        activePerformanceReport,
        profilerLocation,
        performanceLocation,
        setReportLinks,
        isReportLinkingEnabled,
        persistentState.selectedConnection?.host,
    ]);

    const tooltipContent = isLinked ? (
        'Data linked between memory and performance reports'
    ) : (
        <>
            Unable to link active memory and performance reports
            <br />
            Please select reports generated from the same run to see additional data across the visualizer
        </>
    );

    return (
        <Tooltip
            content={tooltipContent}
            position={Position.TOP}
        >
            <Icon
                className={classNames({ 'no-sync-status-icon': !isLinked })}
                icon={isLinked ? IconNames.LINK : IconNames.UNLINK}
                intent={isLinked ? Intent.SUCCESS : Intent.NONE}
            />
        </Tooltip>
    );
};

export default ReportLinkStatus;
