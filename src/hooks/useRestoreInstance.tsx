// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect, useState } from 'react';
import { useSetAtom } from 'jotai';
import {
    activeNpeOpTraceAtom,
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    performanceReportLocationAtom,
    profilerReportLocationAtom,
} from '../store/app';
import { useInstance, useReportFolderList } from './useAPI';
import useRemoteConnection from './useRemote';
import { ReportFolder, ReportLocation } from '../definitions/Reports';
import type { RemoteFolder } from '../definitions/RemoteConnection';

const useRestoreInstance = () => {
    const { data: instance, isLoading } = useInstance();
    const remote = useRemoteConnection();
    const { data: reports } = useReportFolderList();
    const setActiveProfilerReport = useSetAtom(activeProfilerReportAtom);
    const setActivePerformanceReport = useSetAtom(activePerformanceReportAtom);
    const setActiveNpe = useSetAtom(activeNpeOpTraceAtom);
    const setProfilerReportLocation = useSetAtom(profilerReportLocationAtom);
    const setPerformanceReportLocation = useSetAtom(performanceReportLocationAtom);
    const [hasRestoredInstance, setHasRestoredInstance] = useState<boolean>(false);

    useEffect(() => {
        if (instance && reports?.length && !hasRestoredInstance) {
            const isProfilerRemote = instance?.active_report?.profiler_location === ReportLocation.REMOTE;
            const remoteFolders = remote.persistentState.getSavedReportFolders(
                remote.persistentState.selectedConnection,
            );

            const profilerReportPath = instance?.active_report?.profiler_name || null;
            const profilerReportName =
                (isProfilerRemote && profilerReportPath) || instance?.remote_profiler_folder
                    ? getRemoteReportName(remoteFolders, profilerReportPath) || ''
                    : getLocalReportName(reports, profilerReportPath) || '';
            const perfReportPath = instance?.active_report?.performance_name || null;

            const activeProfilerReport = profilerReportPath
                ? {
                      path: profilerReportPath,
                      reportName: profilerReportName,
                  }
                : null;
            const activeProfilerLocation = instance?.active_report?.profiler_location ?? null;
            const activePerfReport = perfReportPath
                ? {
                      path: perfReportPath,
                      reportName: perfReportPath,
                  }
                : null;
            const activePerfLocation = instance?.active_report?.performance_location ?? null;

            const activeReports = {
                profiler: activeProfilerReport,
                profilerLocation: activeProfilerLocation,
                performance: activePerfReport,
                performanceLocation: activePerfLocation,
                npe: instance?.active_report?.npe_name ?? null,
            };

            setHasRestoredInstance(true);

            setActiveProfilerReport(activeReports.profiler);
            setProfilerReportLocation(activeReports.profilerLocation);

            setActivePerformanceReport(activeReports.performance);
            setPerformanceReportLocation(activeReports.performanceLocation);

            setActiveNpe(activeReports.npe);
        }
    }, [
        setActiveProfilerReport,
        setProfilerReportLocation,
        setActivePerformanceReport,
        setPerformanceReportLocation,
        setActiveNpe,
        instance,
        hasRestoredInstance,
        reports,
        remote.persistentState,
    ]);

    return {
        instance,
        isLoading,
        hasRestoredInstance,
    };
};

const getLocalReportName = (reports: ReportFolder[], path: string | null): string | undefined =>
    reports?.find((report) => report.path === path)?.reportName;

const getRemoteReportName = (remoteFolders: RemoteFolder[], folderName: string | null): string | undefined =>
    folderName ? remoteFolders?.find((report) => report.remotePath.includes(folderName))?.reportName : undefined;

export default useRestoreInstance;
