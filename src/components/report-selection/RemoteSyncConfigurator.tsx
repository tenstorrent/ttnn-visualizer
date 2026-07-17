// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect, useMemo, useRef, useState } from 'react';

import { FormGroup } from '@blueprintjs/core';
import { useQueryClient } from '@tanstack/react-query';
import { AxiosResponse, HttpStatusCode } from 'axios';
import { useAtom } from 'jotai';
import { RemoteConnection, RemoteFolder } from '../../definitions/RemoteConnection';
import { ReportLocation } from '../../definitions/Reports';
import createToastNotification, { ToastType } from '../../functions/createToastNotification';
import getRemoteSyncFailureAction, { RemoteSyncFailureAction } from '../../functions/getRemoteSyncFailureAction';
import getResponseError from '../../functions/getResponseError';
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
import { createDataIntegrityWarning, hasBeenNormalised } from '../../functions/validateReportFolder';
import useRemoteConnection from '../../hooks/useRemote';
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
import { DBVersionValidation, evaluateDbVersion } from '../../functions/compareDbVersion';

const RemoteSyncConfigurator = () => {
    const remote = useRemoteConnection();
    const { setPersistentSelectedConnection, setPersistentSavedConnectionList } = remote;
    const queryClient = useQueryClient();
    const disableRemoteSync = !!getServerConfig()?.SERVER_MODE;

    const [profilerReportLocation, setProfilerReportLocation] = useAtom(profilerReportLocationAtom);
    const [performanceReportLocation, setPerformanceReportLocation] = useAtom(performanceReportLocationAtom);
    const [activeProfilerReport, setActiveProfilerReport] = useAtom(activeProfilerReportAtom);
    const [activePerformanceReport, setActivePerformanceReport] = useAtom(activePerformanceReportAtom);

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
            ? remotePerformanceFolderList.find((folder) =>
                  folder.reportName?.includes(activePerformanceReport?.reportName),
              )
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

            if (signal.aborted || localSyncedFoldersAbortRef.current !== abortController) {
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

    const isCurrentLocalScan = (abortController: AbortController, signal: AbortSignal) =>
        !signal.aborted && localSyncedFoldersAbortRef.current === abortController;

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
        createToastNotification('Active memory report', folder.reportName, ToastType.SUCCESS);
    };

    const updatePerformanceSelection = (folder: RemoteFolder) => {
        applyPerformanceReportSelection(folder);
        createToastNotification('Active performance report', folder.reportName, ToastType.SUCCESS);
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

    const syncSelectedReportFolder = async (folder?: RemoteFolder) => {
        const selectedReport = folder ?? selectedReportFolder;

        try {
            setIsSyncingReportFolder(true);

            if (remote.persistentState.selectedConnection) {
                const { data: updatedFolder } = await remote.syncRemoteFolder(
                    remote.persistentState.selectedConnection,
                    selectedReport,
                );

                if (hasBeenNormalised(updatedFolder)) {
                    createDataIntegrityWarning(updatedFolder);
                }

                const savedRemoteFolders = remote.persistentState.getSavedReportFolders(
                    remote.persistentState.selectedConnection,
                );

                const updatedFolders = savedRemoteFolders.map((f) =>
                    f.remotePath === updatedFolder?.remotePath ? updatedFolder : f,
                );

                updateSavedReportFolders(remote.persistentState.selectedConnection, updatedFolders);

                if (selectedReport) {
                    const mountResponse = await remote.mountRemoteFolder(
                        remote.persistentState.selectedConnection,
                        updatedFolder,
                    );

                    if (mountResponse.status === HttpStatusCode.Ok) {
                        updateReportSelection(updatedFolder);
                    }
                }
            }
        } catch (err: unknown) {
            await handleSyncFailure(err, selectedReport, (report, syncErr) =>
                mountLocalFolderOnSyncFailure(
                    report,
                    syncErr,
                    (connection) => remote.mountRemoteFolder(connection, report),
                    applyProfilerReportSelection,
                ),
            );
        } finally {
            // REMOTE_SYNC registry clear is owned by syncRemoteFolder's finally.
            setIsSyncingReportFolder(false);
        }
    };

    const syncSelectedPerfReportFolder = async (folder?: RemoteFolder) => {
        const selectedReport = folder ?? selectedPerformanceFolder;

        try {
            setIsSyncingPerformanceFolder(true);

            if (remote.persistentState.selectedConnection) {
                const { data: updatedFolder } = await remote.syncRemoteFolder(
                    remote.persistentState.selectedConnection,
                    undefined,
                    selectedReport,
                );

                if (hasBeenNormalised(updatedFolder)) {
                    createDataIntegrityWarning(updatedFolder);
                }

                const savedRemoteFolders = remote.persistentState.getSavedPerformanceFolders(
                    remote.persistentState.selectedConnection,
                );

                const updatedFolders = savedRemoteFolders.map((f) =>
                    f.remotePath === updatedFolder?.remotePath ? updatedFolder : f,
                );

                updateSavedPerformanceFolders(remote.persistentState.selectedConnection, updatedFolders);

                if (updatedFolder) {
                    const mountResponse = await remote.mountRemoteFolder(
                        remote.persistentState.selectedConnection,
                        undefined,
                        updatedFolder,
                    );

                    if (mountResponse.status === HttpStatusCode.Ok) {
                        updatePerformanceSelection(updatedFolder);
                    }
                }
            }
        } catch (err: unknown) {
            await handleSyncFailure(err, selectedReport, (report, syncErr) =>
                mountLocalFolderOnSyncFailure(
                    report,
                    syncErr,
                    (connection) => remote.mountRemoteFolder(connection, undefined, report),
                    applyPerformanceReportSelection,
                ),
            );
        } finally {
            // REMOTE_SYNC registry clear is owned by syncRemoteFolder's finally.
            setIsSyncingPerformanceFolder(false);
        }
    };

    const isProfilerRemote = profilerReportLocation === ReportLocation.REMOTE;
    const isPerformanceRemote = performanceReportLocation === ReportLocation.REMOTE;
    const isLoading = isSyncingReportFolder || isSyncingPerformanceFolder;
    const isDisabled = isFetching || isLoading || disableRemoteSync;

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
                    folder.reportName?.includes(activePerformanceReport.reportName),
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
                    loading={isLoading || isFetching}
                    disabled={isDisabled}
                    onSelectFolder={async (folder) => {
                        // Mount the local copy only — never SSH-sync on select so offline /
                        // unreachable hosts still load previously synced reports. Refresh via Sync.
                        if (remote.persistentState.selectedConnection) {
                            setSelectedReportFolder(folder);

                            try {
                                const response = await remote.mountRemoteFolder(
                                    remote.persistentState.selectedConnection,
                                    folder,
                                );

                                if (response.status === HttpStatusCode.Ok) {
                                    updateReportSelection(folder);

                                    if (hasBeenNormalised(folder)) {
                                        createDataIntegrityWarning(folder);
                                    }
                                }
                            } catch (err: unknown) {
                                notifyRemoteFolderMountError(err);
                            }
                        }
                    }}
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
                    loading={isLoading || isFetching}
                    disabled={isDisabled}
                    onSelectFolder={async (folder) => {
                        // Mount the local copy only — never SSH-sync on select so offline /
                        // unreachable hosts still load previously synced reports. Refresh via Sync.
                        if (remote.persistentState.selectedConnection) {
                            setSelectedPerformanceFolder(folder);

                            try {
                                const response = await remote.mountRemoteFolder(
                                    remote.persistentState.selectedConnection,
                                    undefined,
                                    folder,
                                );

                                if (response.status === HttpStatusCode.Ok) {
                                    updatePerformanceSelection(folder);

                                    if (hasBeenNormalised(folder)) {
                                        createDataIntegrityWarning(folder);
                                    }
                                }
                            } catch (err: unknown) {
                                notifyRemoteFolderMountError(err);
                            }
                        }
                    }}
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
