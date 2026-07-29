// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect, useMemo, useRef, useState } from 'react';

import { FormGroup } from '@blueprintjs/core';
import { useQueryClient } from '@tanstack/react-query';
import { AxiosResponse, HttpStatusCode } from 'axios';
import { useAtom, useStore } from 'jotai';
import { RemoteConnection, RemoteFolder } from '../../definitions/RemoteConnection';
import { ReportLocation } from '../../definitions/Reports';
import {
    ACTIVE_MEMORY_REPORT_TOAST_TITLE,
    ACTIVE_PERFORMANCE_REPORT_TOAST_TITLE,
} from '../../definitions/notifyActiveReport';
import createToastNotification from '../../functions/createToastNotification';
import { ToastType } from '../../definitions/ToastType';
import getRemoteSyncFailureAction from '../../functions/getRemoteSyncFailureAction';
import { RemoteSyncFailureAction } from '../../definitions/RemoteSync';
import getResponseError from '../../functions/getResponseError';
import hasPerformanceDiscoveryChanged from '../../functions/hasPerformanceDiscoveryChanged';
import getServerConfig from '../../functions/getServerConfig';
import isRemoteFolderOutdated from '../../functions/isRemoteFolderOutdated';
import mergeRemoteFolders from '../../functions/mergeRemoteFolders';
import notifyFolderSyncError, {
    notifyFolderListSyncError,
    notifyRemoteFolderMountError,
} from '../../functions/notifyFolderSyncError';
import notifyFolderSyncLocalFallback, {
    notifyLocalSyncedReportsListFallback,
} from '../../functions/notifyFolderSyncLocalFallback';
import isPerformanceFolderActive from '../../functions/isPerformanceFolderActive';
import { createDataIntegrityWarning, hasBeenNormalised } from '../../functions/validateReportFolder';
import { useActivatingReport } from '../../hooks/useActivatingReport';
import useRemoteConnection from '../../hooks/useRemote';
import { useReportLinkBadgeIds } from '../../hooks/useReportLinkBadgeIds';
import {
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    performanceReportLocationAtom,
    profilerReportLocationAtom,
} from '../../store/app';
import AddRemoteConnection from './AddRemoteConnection';
import RemoteConnectionSelector from './RemoteConnectionSelector';
import RemoteFolderSelector from './RemoteFolderSelector';
import RemoteSyncButton from './RemoteSyncButton';
import { updateInstance, useReportMetadata } from '../../hooks/useAPI';
import { ActiveReport } from '../../model/APIData';
import { DBVersionValidation } from '../../definitions/Versions';
import { evaluateDbVersion } from '../../functions/compareDbVersion';

const RemoteSyncConfigurator = () => {
    const remote = useRemoteConnection();
    const { setPersistentSelectedConnection, setPersistentSavedConnectionList } = remote;
    const queryClient = useQueryClient();
    const jotaiStore = useStore();
    const disableRemoteSync = !!getServerConfig()?.SERVER_MODE;

    const [profilerReportLocation, setProfilerReportLocation] = useAtom(profilerReportLocationAtom);
    const [performanceReportLocation, setPerformanceReportLocation] = useAtom(performanceReportLocationAtom);
    const [activeProfilerReport, setActiveProfilerReport] = useAtom(activeProfilerReportAtom);
    const [activePerformanceReport, setActivePerformanceReport] = useAtom(activePerformanceReportAtom);
    const { isActivatingReport, withActivatingReport } = useActivatingReport();

    const { data: reportMetadata, error: reportMetadataError } = useReportMetadata();
    useEffect(() => {
        if (reportMetadataError) {
            return;
        }
        if (reportMetadata) {
            const dbValidationResult = evaluateDbVersion(reportMetadata.version);
            if (dbValidationResult.statusCode !== DBVersionValidation.OK) {
                // @ts-expect-error its only empty when status is OK, and we dont do a toast here
                createToastNotification('Incompatible report version', dbValidationResult.message, ToastType.WARNING);
            }
        }
    }, [reportMetadata, reportMetadataError]);

    const [isFetching, setIsFetching] = useState(false);
    const [reportFolderList, setReportFolders] = useState<RemoteFolder[]>(
        remote.persistentState.getSavedReportFolders(remote.persistentState.selectedConnection),
    );
    const [isSyncingReportFolder, setIsSyncingReportFolder] = useState(false);
    const [selectedReportFolder, setSelectedReportFolder] = useState<RemoteFolder | undefined>(
        activeProfilerReport
            ? reportFolderList.find((folder) => folder.remotePath?.includes(activeProfilerReport.path))
            : undefined,
    );
    const [remotePerformanceFolderList, setRemotePerformanceFolders] = useState<RemoteFolder[]>(
        remote.persistentState.getSavedPerformanceFolders(remote.persistentState.selectedConnection),
    );
    const [isSyncingPerformanceFolder, setIsSyncingPerformanceFolder] = useState(false);
    const [selectedPerformanceFolder, setSelectedPerformanceFolder] = useState<RemoteFolder | undefined>(
        activePerformanceReport
            ? remotePerformanceFolderList.find((folder) => isPerformanceFolderActive(folder, activePerformanceReport))
            : remotePerformanceFolderList[0],
    );
    // Aborts in-flight local disk scans when the connection changes quickly.
    const localSyncedFoldersAbortRef = useRef<AbortController | null>(null);

    const updateSelectedConnection = async (connection: RemoteConnection) => {
        setPersistentSelectedConnection(connection);
        setReportFolders(remote.persistentState.getSavedReportFolders(connection));
        setRemotePerformanceFolders(remote.persistentState.getSavedPerformanceFolders(connection));

        const activeReport: ActiveReport = {};

        if (selectedReportFolder && profilerReportLocation === ReportLocation.REMOTE) {
            setSelectedReportFolder(undefined);
            setActiveProfilerReport(null);
            activeReport.profiler_name = ''; // Empty string will clear the active report on the backend
        }

        if (selectedPerformanceFolder && performanceReportLocation === ReportLocation.REMOTE) {
            setSelectedPerformanceFolder(undefined);
            setActivePerformanceReport(null);
            activeReport.performance_name = ''; // Empty string will clear the active report on the backend
        }

        if (Object.keys(activeReport).length > 0) {
            await updateInstance({
                active_report: activeReport,
            });
        }

        // Populate report dropdowns from on-disk synced copies for this host (no SSH).
        // Fire-and-forget so connection switch stays cache-fast; abort cancels prior scans.
        loadLocalSyncedFolders(connection).catch(() => {
            // Local scan is best-effort; cached folders remain if it fails.
        });
    };

    const isCurrentLocalScan = (abortController: AbortController, signal: AbortSignal) =>
        !signal.aborted && localSyncedFoldersAbortRef.current === abortController;

    const loadLocalSyncedFolders = async (connection: RemoteConnection) => {
        localSyncedFoldersAbortRef.current?.abort();
        const abortController = new AbortController();
        localSyncedFoldersAbortRef.current = abortController;
        const { signal } = abortController;

        try {
            const [localProfilerFolders, localPerformanceFolders] = await Promise.allSettled([
                connection.profilerPath ? remote.listLocalProfilerReports(connection, signal) : Promise.resolve([]),
                connection.performancePath
                    ? remote.listLocalPerformanceReports(connection, signal)
                    : Promise.resolve([]),
            ]);

            if (!isCurrentLocalScan(abortController, signal)) {
                return;
            }

            // Always replace cached lists on a successful scan — including []. Otherwise
            // never-synced / empty local dirs from an older remote fetch stay visible.
            if (localProfilerFolders.status === 'fulfilled') {
                updateSavedReportFolders(connection, localProfilerFolders.value);
            }

            if (localPerformanceFolders.status === 'fulfilled') {
                updateSavedPerformanceFolders(connection, localPerformanceFolders.value);
            }
        } finally {
            if (localSyncedFoldersAbortRef.current === abortController) {
                localSyncedFoldersAbortRef.current = null;
            }
        }
    };

    const applyRemoteOrLocalFolderList = async (
        remoteResult: PromiseSettledResult<RemoteFolder[]>,
        connection: RemoteConnection,
        pathPresent: boolean,
        listLocal: (connection: RemoteConnection, signal?: AbortSignal) => Promise<RemoteFolder[]>,
        updateSaved: (connection: RemoteConnection, folders: RemoteFolder[]) => void,
        abortController: AbortController,
        signal: AbortSignal,
    ): Promise<{ usedLocalFallback: boolean; error: string | null }> => {
        if (remoteResult.status === 'fulfilled') {
            if (!isCurrentLocalScan(abortController, signal)) {
                return { usedLocalFallback: false, error: null };
            }
            updateSaved(connection, remoteResult.value);
            return { usedLocalFallback: false, error: null };
        }

        if (!pathPresent) {
            return { usedLocalFallback: false, error: null };
        }

        try {
            const localFolders = await listLocal(connection, signal);
            if (!isCurrentLocalScan(abortController, signal)) {
                return { usedLocalFallback: false, error: null };
            }
            updateSaved(connection, localFolders);

            if (localFolders.length > 0) {
                return { usedLocalFallback: true, error: null };
            }

            return { usedLocalFallback: false, error: getResponseError(remoteResult.reason) };
        } catch {
            if (!isCurrentLocalScan(abortController, signal)) {
                return { usedLocalFallback: false, error: null };
            }
            return { usedLocalFallback: false, error: getResponseError(remoteResult.reason) };
        }
    };

    const fetchRemoteFolderLists = async (connection: RemoteConnection) => {
        localSyncedFoldersAbortRef.current?.abort();
        const abortController = new AbortController();
        localSyncedFoldersAbortRef.current = abortController;
        const { signal } = abortController;

        try {
            setIsFetching(true);

            const [reportFolders, performanceFolders] = await Promise.allSettled([
                connection.profilerPath ? remote.listProfilerReports(connection, signal) : Promise.resolve([]),
                connection.performancePath ? remote.listPerformanceReports(connection, signal) : Promise.resolve([]),
            ]);

            if (!isCurrentLocalScan(abortController, signal)) {
                return;
            }

            // Run local fallbacks in parallel when both SSH lists fail (same dual-failure cost).
            const [profilerOutcome, performanceOutcome] = await Promise.all([
                applyRemoteOrLocalFolderList(
                    reportFolders,
                    connection,
                    Boolean(connection.profilerPath),
                    remote.listLocalProfilerReports,
                    updateSavedReportFolders,
                    abortController,
                    signal,
                ),
                applyRemoteOrLocalFolderList(
                    performanceFolders,
                    connection,
                    Boolean(connection.performancePath),
                    remote.listLocalPerformanceReports,
                    updateSavedPerformanceFolders,
                    abortController,
                    signal,
                ),
            ]);

            if (!isCurrentLocalScan(abortController, signal)) {
                return;
            }

            if (profilerOutcome.usedLocalFallback || performanceOutcome.usedLocalFallback) {
                notifyLocalSyncedReportsListFallback();
            }

            const fetchErrors = [profilerOutcome.error, performanceOutcome.error].filter(
                (error): error is string => error !== null,
            );

            if (fetchErrors.length > 0) {
                notifyFolderListSyncError(fetchErrors.join('; '));
            }
        } catch (err: unknown) {
            if (isCurrentLocalScan(abortController, signal)) {
                notifyFolderListSyncError(getResponseError(err));
            }
        } finally {
            if (localSyncedFoldersAbortRef.current === abortController) {
                localSyncedFoldersAbortRef.current = null;
            }
            setIsFetching(false);
        }
    };

    const updateSavedReportFolders = (connection: RemoteConnection, updatedFolders: RemoteFolder[]) => {
        if (!connection) {
            return [];
        }

        const mergedFolders = mergeRemoteFolders(
            remote.persistentState.getSavedReportFolders(connection),
            updatedFolders,
        );

        remote.persistentState.setSavedReportFolders(connection, mergedFolders);
        setReportFolders(mergedFolders);

        return mergedFolders;
    };

    const updateSavedPerformanceFolders = (connection: RemoteConnection, updatedFolders: RemoteFolder[]) => {
        if (!connection) {
            return [];
        }

        const mergedFolders = mergeRemoteFolders(
            remote.persistentState.getSavedPerformanceFolders(connection),
            updatedFolders,
        );

        remote.persistentState.setSavedPerformanceFolders(connection, mergedFolders);
        setRemotePerformanceFolders(mergedFolders);

        return mergedFolders;
    };

    const findConnectionIndex = (connection?: RemoteConnection) => {
        return remote.persistentState.savedConnectionList.findIndex((c) => {
            const isSameName = c.name === connection?.name;
            const isSameHost = c.host === connection?.host;
            const isSamePort = c.port === connection?.port;

            return isSameName && isSameHost && isSamePort;
        });
    };

    const applyProfilerReportSelection = (folder: RemoteFolder) => {
        queryClient.clear();
        setProfilerReportLocation(ReportLocation.REMOTE);
        setActiveProfilerReport({
            path: folder.remotePath,
            reportName: folder.reportName,
        });
    };

    const applyPerformanceReportSelection = (folder: RemoteFolder) => {
        queryClient.clear();
        setPerformanceReportLocation(ReportLocation.REMOTE);
        setActivePerformanceReport({
            path: folder.remotePath,
            reportName: folder.reportName,
        });
    };

    const updateReportSelection = (folder: RemoteFolder) => {
        applyProfilerReportSelection(folder);
        createToastNotification(ACTIVE_MEMORY_REPORT_TOAST_TITLE, folder.reportName, ToastType.SUCCESS);
    };

    const updatePerformanceSelection = (folder: RemoteFolder) => {
        applyPerformanceReportSelection(folder);
        createToastNotification(ACTIVE_PERFORMANCE_REPORT_TOAST_TITLE, folder.reportName, ToastType.SUCCESS);
    };

    const mountLocalFolderOnSyncFailure = async (
        selectedReport: RemoteFolder,
        err: unknown,
        mount: (connection: RemoteConnection) => Promise<AxiosResponse>,
        applySelection: (folder: RemoteFolder) => void,
    ) => {
        const connection = remote.persistentState.selectedConnection;

        if (!connection) {
            notifyFolderSyncError(err);
            return;
        }

        try {
            const mountResponse = await mount(connection);

            if (mountResponse.status === HttpStatusCode.Ok) {
                applySelection(selectedReport);
                notifyFolderSyncLocalFallback(err);

                if (hasBeenNormalised(selectedReport)) {
                    createDataIntegrityWarning(selectedReport);
                }

                return;
            }
        } catch {
            // Mount itself failed; surface the original sync error below.
        }

        notifyFolderSyncError(err);
    };

    const handleSyncFailure = async (
        err: unknown,
        selectedReport: RemoteFolder | undefined,
        mountLocalFallback: (folder: RemoteFolder, err: unknown) => Promise<void>,
    ) => {
        const failureAction = getRemoteSyncFailureAction(err, selectedReport);

        if (failureAction === RemoteSyncFailureAction.IGNORE_CANCEL) {
            return;
        }

        if (failureAction === RemoteSyncFailureAction.FALLBACK_LOCAL && selectedReport) {
            await mountLocalFallback(selectedReport, err);
            return;
        }

        notifyFolderSyncError(err);
    };

    const mountAndActivateFolder = async (
        folder: RemoteFolder,
        {
            mount,
            activateWithToast,
        }: {
            mount: (connection: RemoteConnection, folder: RemoteFolder) => Promise<AxiosResponse>;
            activateWithToast: (folder: RemoteFolder) => void;
        },
    ) => {
        const connection = remote.persistentState.selectedConnection;
        if (!connection) {
            return;
        }

        await withActivatingReport(async () => {
            try {
                const response = await mount(connection, folder);

                if (response.status === HttpStatusCode.Ok) {
                    activateWithToast(folder);

                    if (hasBeenNormalised(folder)) {
                        createDataIntegrityWarning(folder);
                    }
                }
            } catch (err: unknown) {
                notifyRemoteFolderMountError(err);
            }
        });
    };

    const syncSelectedFolder = async ({
        selected,
        setSyncing,
        sync,
        getSaved,
        updateSaved,
        mount,
        activateWithToast,
        applySelection,
        getActivePath,
    }: {
        selected: RemoteFolder | undefined;
        setSyncing: (syncing: boolean) => void;
        sync: (connection: RemoteConnection, folder: RemoteFolder) => Promise<AxiosResponse<RemoteFolder>>;
        getSaved: (connection: RemoteConnection) => RemoteFolder[];
        updateSaved: (connection: RemoteConnection, folders: RemoteFolder[]) => RemoteFolder[];
        mount: (connection: RemoteConnection, folder: RemoteFolder) => Promise<AxiosResponse>;
        activateWithToast: (folder: RemoteFolder) => void;
        applySelection: (folder: RemoteFolder) => void;
        getActivePath: () => string | null | undefined;
    }) => {
        setSyncing(true);

        try {
            const connection = remote.persistentState.selectedConnection;
            if (!connection || !selected) {
                return;
            }

            // Snapshot before transfer — local pickers stay usable while syncing.
            const activePathAtSyncStart = getActivePath() ?? null;

            const shouldActivateAfterSync = () => {
                const currentActivePath = getActivePath() ?? null;
                // User activated a different report during the transfer; keep their choice.
                return currentActivePath === activePathAtSyncStart || currentActivePath === selected.remotePath;
            };

            try {
                // Transfer only — do not hold isActivatingReportAtom here or local
                // report pickers spin for the whole SSH sync (progress is FileStatusOverlay).
                const { data: updatedFolder } = await sync(connection, selected);

                const updatedFolders = getSaved(connection).map((f) =>
                    f.remotePath === updatedFolder?.remotePath ? updatedFolder : f,
                );

                updateSaved(connection, updatedFolders);

                if (updatedFolder && shouldActivateAfterSync()) {
                    await mountAndActivateFolder(updatedFolder, { mount, activateWithToast });
                }
            } catch (err: unknown) {
                await handleSyncFailure(err, selected, async (report, syncErr) => {
                    if (!shouldActivateAfterSync()) {
                        notifyFolderSyncError(syncErr);
                        return;
                    }
                    await withActivatingReport(() =>
                        mountLocalFolderOnSyncFailure(report, syncErr, (conn) => mount(conn, report), applySelection),
                    );
                });
            }
        } finally {
            // REMOTE_SYNC registry clear is owned by syncRemoteFolder's finally.
            setSyncing(false);
        }
    };

    const syncSelectedReportFolder = (folder?: RemoteFolder) =>
        syncSelectedFolder({
            selected: folder ?? selectedReportFolder,
            setSyncing: setIsSyncingReportFolder,
            sync: (connection, report) => remote.syncRemoteFolder(connection, report),
            getSaved: remote.persistentState.getSavedReportFolders,
            updateSaved: updateSavedReportFolders,
            mount: (connection, report) => remote.mountRemoteFolder(connection, report),
            activateWithToast: updateReportSelection,
            applySelection: applyProfilerReportSelection,
            getActivePath: () => jotaiStore.get(activeProfilerReportAtom)?.path,
        });

    const syncSelectedPerfReportFolder = (folder?: RemoteFolder) =>
        syncSelectedFolder({
            selected: folder ?? selectedPerformanceFolder,
            setSyncing: setIsSyncingPerformanceFolder,
            sync: (connection, report) => remote.syncRemoteFolder(connection, undefined, report),
            getSaved: remote.persistentState.getSavedPerformanceFolders,
            updateSaved: updateSavedPerformanceFolders,
            mount: (connection, report) => remote.mountRemoteFolder(connection, undefined, report),
            activateWithToast: updatePerformanceSelection,
            applySelection: applyPerformanceReportSelection,
            getActivePath: () => jotaiStore.get(activePerformanceReportAtom)?.path,
        });

    /**
     * Never-synced folders sync on select (may fail offline — falls back if a local
     * copy exists). Previously synced folders mount the on-disk copy even when
     * stale; refresh via the Sync button.
     */
    const selectAndActivateFolder = async (
        folder: RemoteFolder,
        {
            setSelected,
            syncFolder,
            mount,
            activateWithToast,
        }: {
            setSelected: (folder: RemoteFolder) => void;
            syncFolder: (folder: RemoteFolder) => Promise<void>;
            mount: (connection: RemoteConnection, folder: RemoteFolder) => Promise<AxiosResponse>;
            activateWithToast: (folder: RemoteFolder) => void;
        },
    ) => {
        setSelected(folder);

        if (!folder.lastSynced) {
            await syncFolder(folder);
            return;
        }

        await mountAndActivateFolder(folder, { mount, activateWithToast });
    };

    const isProfilerRemote = profilerReportLocation === ReportLocation.REMOTE;
    const isPerformanceRemote = performanceReportLocation === ReportLocation.REMOTE;
    const isLoading = isSyncingReportFolder || isSyncingPerformanceFolder || isActivatingReport;
    const isDisabled = isFetching || isLoading || disableRemoteSync;

    const selectedRemoteHost = remote.persistentState.selectedConnection?.host ?? null;
    const { linkedPerfIds, unlinkedPerfIds, linkedProfilerReportIds, unlinkedProfilerReportIds } =
        useReportLinkBadgeIds({ remoteHost: selectedRemoteHost });

    // On mount (and when SERVER_MODE is off), seed dropdowns from on-disk synced copies
    // for the currently selected host so offline use works without clicking Fetch.
    // Cleanup aborts any in-flight scan so unmount cannot call setState after teardown.
    useEffect(() => {
        if (!disableRemoteSync) {
            const connection = remote.persistentState.selectedConnection;

            if (connection) {
                loadLocalSyncedFolders(connection).catch(() => {
                    // Local scan is best-effort; cached folders remain if it fails.
                });
            }
        }

        return () => {
            localSyncedFoldersAbortRef.current?.abort();
        };
        // Intentionally once on mount for the persisted selection; connection changes go
        // through updateSelectedConnection which also calls loadLocalSyncedFolders.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount seed only
    }, []);

    // Populates the selectedReportFolder if there is a stored activeProfilerReport
    useEffect(() => {
        queueMicrotask(() => {
            if (activeProfilerReport && isProfilerRemote) {
                const matchedFolder = reportFolderList.find((folder) =>
                    folder.remotePath?.includes(activeProfilerReport.path),
                );

                setSelectedReportFolder(matchedFolder);
            }

            if (activePerformanceReport && isPerformanceRemote) {
                const matchedFolder = remotePerformanceFolderList.find((folder) =>
                    isPerformanceFolderActive(folder, activePerformanceReport),
                );

                setSelectedPerformanceFolder(matchedFolder);
            }
        });
    }, [
        activeProfilerReport,
        profilerReportLocation,
        reportFolderList,
        activePerformanceReport,
        remotePerformanceFolderList,
        performanceReportLocation,
        isProfilerRemote,
        isPerformanceRemote,
    ]);

    const isSelectedReportFolderOutdated = useMemo(
        () => (selectedReportFolder ? isRemoteFolderOutdated(selectedReportFolder) : false),
        [selectedReportFolder],
    );
    const isSelectedPerfFolderOutdated = useMemo(
        () => (selectedPerformanceFolder ? isRemoteFolderOutdated(selectedPerformanceFolder) : false),
        [selectedPerformanceFolder],
    );

    return (
        <>
            <FormGroup
                className='form-group'
                label={<h3 className='label'>Add remote sync server</h3>}
                subLabel='Add new server connection details'
            >
                <AddRemoteConnection
                    disabled={isDisabled}
                    onAddConnection={async (newConnection) => {
                        setPersistentSavedConnectionList([
                            ...remote.persistentState.savedConnectionList,
                            newConnection,
                        ]);

                        await updateSelectedConnection(newConnection);
                    }}
                />
            </FormGroup>

            <FormGroup
                className='form-group'
                label={<h3 className='label'>Use remote sync server</h3>}
                subLabel='Select remote server that will be used for syncing folders'
            >
                <RemoteConnectionSelector
                    connection={remote.persistentState.selectedConnection}
                    connectionList={remote.persistentState.savedConnectionList}
                    disabled={isDisabled}
                    loading={isFetching}
                    onEditConnection={async (updatedConnection, oldConnection) => {
                        const updatedConnections = [...remote.persistentState.savedConnectionList];

                        updatedConnections[findConnectionIndex(oldConnection)] = updatedConnection;
                        setPersistentSavedConnectionList(updatedConnections);
                        remote.persistentState.updateSavedRemoteFoldersConnection(oldConnection, updatedConnection);

                        if (hasPerformanceDiscoveryChanged(oldConnection, updatedConnection)) {
                            remote.persistentState.deleteSavedPerformanceFolders(updatedConnection);
                            setSelectedPerformanceFolder(undefined);
                        }

                        await updateSelectedConnection(updatedConnection);
                    }}
                    onRemoveConnection={async (connection) => {
                        const updatedConnections = [...remote.persistentState.savedConnectionList];

                        updatedConnections.splice(findConnectionIndex(connection), 1);
                        setPersistentSavedConnectionList(updatedConnections);
                        remote.persistentState.deleteSavedReportFolders(connection);
                        remote.persistentState.deleteSavedPerformanceFolders(connection);

                        await updateSelectedConnection(updatedConnections[0]);
                    }}
                    onSelectConnection={async (connection) => {
                        await updateSelectedConnection(connection);
                    }}
                    onSyncRemoteFolderList={async () => {
                        if (remote.persistentState.selectedConnection) {
                            await fetchRemoteFolderLists(remote.persistentState.selectedConnection);
                        }
                    }}
                />
            </FormGroup>

            <FormGroup
                className='form-group'
                label={<h3 className='label'>Memory report</h3>}
                subLabel='Select a memory report'
            >
                <RemoteFolderSelector
                    remoteFolder={isProfilerRemote ? selectedReportFolder : undefined}
                    remoteFolderList={reportFolderList}
                    disabled={isDisabled}
                    linkedIds={linkedProfilerReportIds}
                    unlinkedIds={unlinkedProfilerReportIds}
                    onSelectFolder={(folder) =>
                        selectAndActivateFolder(folder, {
                            setSelected: setSelectedReportFolder,
                            syncFolder: syncSelectedReportFolder,
                            mount: (connection, report) => remote.mountRemoteFolder(connection, report),
                            activateWithToast: updateReportSelection,
                        })
                    }
                    type='profiler'
                    showReportName
                >
                    {(isProfilerRemote || isSyncingReportFolder) && selectedReportFolder && (
                        <RemoteSyncButton
                            isDisabled={isDisabled}
                            selectedReportFolder={selectedReportFolder}
                            isSyncingReportFolder={isSyncingReportFolder}
                            isSelectedReportFolderOutdated={isSelectedReportFolderOutdated}
                            handleClick={syncSelectedReportFolder}
                        />
                    )}
                </RemoteFolderSelector>
            </FormGroup>

            <FormGroup
                className='form-group'
                label={<h3 className='label'>Performance report</h3>}
                subLabel='Select a performance report'
            >
                <RemoteFolderSelector
                    remoteFolder={isPerformanceRemote ? selectedPerformanceFolder : undefined}
                    remoteFolderList={remotePerformanceFolderList}
                    disabled={isDisabled}
                    linkedIds={linkedPerfIds}
                    unlinkedIds={unlinkedPerfIds}
                    onSelectFolder={(folder) =>
                        selectAndActivateFolder(folder, {
                            setSelected: setSelectedPerformanceFolder,
                            syncFolder: syncSelectedPerfReportFolder,
                            mount: (connection, report) => remote.mountRemoteFolder(connection, undefined, report),
                            activateWithToast: updatePerformanceSelection,
                        })
                    }
                    type='performance'
                >
                    {(isPerformanceRemote || isSyncingPerformanceFolder) && selectedPerformanceFolder && (
                        <RemoteSyncButton
                            isDisabled={isDisabled}
                            selectedReportFolder={selectedPerformanceFolder}
                            isSyncingReportFolder={isSyncingPerformanceFolder}
                            isSelectedReportFolderOutdated={isSelectedPerfFolderOutdated}
                            handleClick={syncSelectedPerfReportFolder}
                        />
                    )}
                </RemoteFolderSelector>
            </FormGroup>
        </>
    );
};

export default RemoteSyncConfigurator;
