// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
    activeMlirJsonAtom,
    activeNpeOpTraceAtom,
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    performanceReportLocationAtom,
    profilerReportLocationAtom,
} from '../store/app';
import { useInstance } from './useAPI';
import useRemoteConnection from './useRemote';
import { ReportLocation } from '../definitions/Reports';
import type { RemoteFolder } from '../definitions/RemoteConnection';
import { resolveRemoteReportIdentity } from '../functions/reportLinks';
import { useResetMemoryListStates } from './useRestoreScrollPosition';

const useRestoreInstance = () => {
    const { data: instance, isLoading } = useInstance();
    const remote = useRemoteConnection();
    const { resetMemoryListStates } = useResetMemoryListStates();

    const [hasRestoredInstance, setHasRestoredInstance] = useState<boolean>(false);
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const setActiveProfilerReport = useSetAtom(activeProfilerReportAtom);
    const setActivePerformanceReport = useSetAtom(activePerformanceReportAtom);
    const setActiveNpe = useSetAtom(activeNpeOpTraceAtom);
    const setActiveMlirJson = useSetAtom(activeMlirJsonAtom);
    const setProfilerReportLocation = useSetAtom(profilerReportLocationAtom);
    const setPerformanceReportLocation = useSetAtom(performanceReportLocationAtom);

    const previousProfilerPathRef = useRef<string | null | undefined>(undefined);

    useEffect(() => {
        if (!instance || hasRestoredInstance) {
            return;
        }

        const isProfilerRemote = instance?.active_report?.profiler_location === ReportLocation.REMOTE;
        const isPerformanceRemote = instance?.active_report?.performance_location === ReportLocation.REMOTE;
        const { selectedConnection } = remote.persistentState;
        const remoteFolders = remote.persistentState.getSavedReportFolders(selectedConnection);
        const remotePerformanceFolders = remote.persistentState.getSavedPerformanceFolders(selectedConnection);
        const remoteHost = selectedConnection?.host ?? instance?.remote_connection?.host ?? null;

        const profilerReportPath = instance?.active_report?.profiler_name || null;
        const perfReportPath = instance?.active_report?.performance_name || null;

        let restoredProfilerIdentity = null;
        if (isProfilerRemote) {
            restoredProfilerIdentity = resolveRemoteReportIdentity(remoteFolders, profilerReportPath, remoteHost);
        } else if (profilerReportPath) {
            restoredProfilerIdentity = {
                path: profilerReportPath,
                location: ReportLocation.LOCAL,
                host: null as string | null,
            };
        }

        const restoredProfilerReport = restoredProfilerIdentity
            ? {
                  path: restoredProfilerIdentity.path,
                  reportName: isProfilerRemote
                      ? (getRemoteReportName(remoteFolders, profilerReportPath) ?? restoredProfilerIdentity.path)
                      : restoredProfilerIdentity.path,
                  host: restoredProfilerIdentity.host,
              }
            : null;

        let restoredPerformanceIdentity = null;
        if (isPerformanceRemote) {
            restoredPerformanceIdentity = resolveRemoteReportIdentity(
                remotePerformanceFolders,
                perfReportPath,
                remoteHost,
            );
        } else if (perfReportPath) {
            restoredPerformanceIdentity = {
                path: perfReportPath,
                location: ReportLocation.LOCAL,
                host: null as string | null,
            };
        }

        const activePerfReport = restoredPerformanceIdentity
            ? {
                  path: restoredPerformanceIdentity.path,
                  reportName: isPerformanceRemote
                      ? (getRemoteReportName(remotePerformanceFolders, perfReportPath) ??
                        restoredPerformanceIdentity.path)
                      : restoredPerformanceIdentity.path,
                  host: restoredPerformanceIdentity.host,
              }
            : null;

        const activeProfilerLocation = instance?.active_report?.profiler_location ?? null;
        const activePerfLocation = instance?.active_report?.performance_location ?? null;

        const activeReports = {
            profiler: restoredProfilerReport,
            profilerLocation: activeProfilerLocation,
            performance: activePerfReport,
            performanceLocation: activePerfLocation,
            npe: instance?.active_report?.npe_name ?? null,
            mlir: instance?.active_report?.mlir_name ?? null,
        };

        // Executed at a safe time prior to control returning to the browser's event loop
        queueMicrotask(() => {
            setHasRestoredInstance(true);

            setActiveProfilerReport(activeReports.profiler);
            setProfilerReportLocation(activeReports.profilerLocation);

            setActivePerformanceReport(activeReports.performance);
            setPerformanceReportLocation(activeReports.performanceLocation);

            setActiveNpe(activeReports.npe);
            setActiveMlirJson(activeReports.mlir);
        });
        // Intentionally omit `reports` and `remote.persistentState` — waiting on the
        // folder-list query blocked restore (lengthy "Initializing instance…"), and
        // persistentState is a new object every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once per instance
    }, [
        setActiveProfilerReport,
        setProfilerReportLocation,
        setActivePerformanceReport,
        setPerformanceReportLocation,
        setActiveNpe,
        setActiveMlirJson,
        instance,
        hasRestoredInstance,
    ]);

    useEffect(() => {
        if (!hasRestoredInstance) {
            return;
        }

        const nextProfilerPath = activeProfilerReport?.path ?? null;

        // Baseline the first observed value after restore to avoid false resets during hydration.
        if (previousProfilerPathRef.current === undefined) {
            previousProfilerPathRef.current = nextProfilerPath;
            return;
        }

        if (previousProfilerPathRef.current !== nextProfilerPath) {
            resetMemoryListStates();
            previousProfilerPathRef.current = nextProfilerPath;
        }
    }, [activeProfilerReport?.path, hasRestoredInstance, resetMemoryListStates]);

    return {
        instance,
        isLoading,
        hasRestoredInstance,
    };
};

const getRemoteReportName = (remoteFolders: RemoteFolder[], folderName: string | null): string | undefined =>
    folderName
        ? remoteFolders?.find(
              (report) =>
                  report.remotePath === folderName ||
                  report.remotePath.endsWith(`/${folderName}`) ||
                  report.reportName === folderName,
          )?.reportName
        : undefined;

export default useRestoreInstance;
