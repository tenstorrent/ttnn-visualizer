// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import {
    activeMlirJsonAtom,
    activeNpeOpTraceAtom,
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    mlirLoadedReportsAtom,
    performanceReportLocationAtom,
    profilerReportLocationAtom,
} from '../store/app';
import { useInstance, useReportFolderList } from './useAPI';
import useRemoteConnection from './useRemote';
import { ReportLocation } from '../definitions/Reports';
import type { RemoteFolder } from '../definitions/RemoteConnection';
import { useResetMemoryListStates } from './useRestoreScrollPosition';

const useRestoreInstance = () => {
    const store = useStore();
    const { data: instance, isLoading: isInstanceLoading } = useInstance();
    const remote = useRemoteConnection();
    // `useReportFolderList` seeds `initialData: null`, so `data === null` means
    // "fetch not finished" — but a failed fetch also leaves `null`. Treat error
    // as settled so restore cannot hang with no request in flight.
    const { data: reports, isError: isReportsError } = useReportFolderList();
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

    const isReportsSettled = Array.isArray(reports) || isReportsError;

    // One-shot hydrate from settled instance/folder queries into jotai. Sync
    // setState is intentional: ProtectedRoute must flip hasRestoredInstance in
    // the same commit as the atom writes. Deferring (queueMicrotask) left
    // isLoading&&!restored hanging under Strict Mode remounts.
    /* eslint-disable react-hooks/set-state-in-effect -- one-shot restore hydrate; see above */
    useEffect(() => {
        if (hasRestoredInstance || !isReportsSettled) {
            return;
        }

        // Wait only when the first instance payload has not arrived. Do not block on
        // background refetch — that was racing Strict Mode remounts after hydrate.
        if (instance === undefined && isInstanceLoading) {
            return;
        }

        if (!instance) {
            setHasRestoredInstance(true);
            return;
        }

        const isProfilerRemote = instance.active_report?.profiler_location === ReportLocation.REMOTE;
        const remoteFolders = remote.persistentState.getSavedReportFolders(remote.persistentState.selectedConnection);

        const profilerReportPath = instance.active_report?.profiler_name || null;
        const shouldResolveRemoteProfilerReportName = isProfilerRemote || !!instance.remote_profiler_folder;
        const profilerReportName = shouldResolveRemoteProfilerReportName
            ? getRemoteReportName(remoteFolders, profilerReportPath)
            : profilerReportPath;
        const perfReportPath = instance.active_report?.performance_name || null;

        const restoredProfilerReport = profilerReportPath
            ? {
                  path: profilerReportPath,
                  reportName: profilerReportName ?? profilerReportPath,
              }
            : null;
        const activeProfilerLocation = instance.active_report?.profiler_location ?? null;
        const activePerfReport = perfReportPath
            ? {
                  path: perfReportPath,
                  reportName: perfReportPath,
              }
            : null;
        const activePerfLocation = instance.active_report?.performance_location ?? null;

        setActiveProfilerReport(restoredProfilerReport);
        setProfilerReportLocation(activeProfilerLocation);

        setActivePerformanceReport(activePerfReport);
        setPerformanceReportLocation(activePerfLocation);

        setActiveNpe(instance.active_report?.npe_name ?? null);
        // Writing activeMlirJsonAtom replaces the whole loaded-reports list.
        // Skip when a View (including multi-file split) already seeded memory.
        if (store.get(mlirLoadedReportsAtom).length === 0) {
            setActiveMlirJson(instance.active_report?.mlir_name ?? null);
        }

        setHasRestoredInstance(true);
    }, [
        setActiveProfilerReport,
        setProfilerReportLocation,
        setActivePerformanceReport,
        setPerformanceReportLocation,
        setActiveNpe,
        setActiveMlirJson,
        instance,
        isInstanceLoading,
        isReportsSettled,
        hasRestoredInstance,
        remote.persistentState,
        store,
    ]);
    /* eslint-enable react-hooks/set-state-in-effect */

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
        isLoading: isInstanceLoading,
        hasRestoredInstance,
    };
};

const getRemoteReportName = (remoteFolders: RemoteFolder[], folderName: string | null): string | undefined =>
    folderName ? remoteFolders?.find((report) => report.remotePath.includes(folderName))?.reportName : undefined;

export default useRestoreInstance;
