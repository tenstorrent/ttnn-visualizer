// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Icon, Intent, Position, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { useGetDeviceOperationListPerf } from '../hooks/useAPI';
import {
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    performanceReportLocationAtom,
    profilerReportLocationAtom,
    successfulReportLinksAtom,
} from '../store/app';
import { addReportLink } from '../functions/reportLinks';
import getServerConfig from '../functions/getServerConfig';

const ReportLinkStatus = () => {
    const useGetDeviceOperationListPerfResult = useGetDeviceOperationListPerf();
    const canMatchOperations = useGetDeviceOperationListPerfResult.length > 0;

    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const profilerLocation = useAtomValue(profilerReportLocationAtom);
    const performanceLocation = useAtomValue(performanceReportLocationAtom);
    const setReportLinks = useSetAtom(successfulReportLinksAtom);

    const isReportLinkingEnabled = !!getServerConfig()?.REPORT_LINKING_ENABLED;

    // Lazily record the active pair whenever it links successfully, so the report
    // selection lists can later badge known counterparts of the active report.
    useEffect(() => {
        if (
            !isReportLinkingEnabled ||
            !canMatchOperations ||
            !activeProfilerReport ||
            !activePerformanceReport ||
            !profilerLocation ||
            !performanceLocation
        ) {
            return;
        }

        setReportLinks((links) =>
            addReportLink(links, {
                profilerPath: activeProfilerReport.path,
                profilerLocation,
                performancePath: activePerformanceReport.path,
                performanceLocation,
            }),
        );
    }, [
        canMatchOperations,
        activeProfilerReport,
        activePerformanceReport,
        profilerLocation,
        performanceLocation,
        setReportLinks,
        isReportLinkingEnabled,
    ]);

    // Compute icon and messaging
    const tooltipContent = canMatchOperations ? (
        'Data linked between memory and performance reports'
    ) : (
        <>
            Unable to link active memory and performance reports
            <br />
            Please select reports generated from the same run to see additional data across the visualizer
        </>
    );
    const icon = canMatchOperations ? IconNames.LINK : IconNames.UNLINK;
    const intent = canMatchOperations ? Intent.SUCCESS : Intent.NONE;

    return (
        <Tooltip
            content={tooltipContent}
            position={Position.TOP}
        >
            <Icon
                className={classNames({ 'no-sync-status-icon': !canMatchOperations })}
                icon={icon}
                intent={intent}
            />
        </Tooltip>
    );
};

export default ReportLinkStatus;
