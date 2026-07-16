// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect, useMemo, useState } from 'react';

import { FormGroup } from '@blueprintjs/core';
import { useQueryClient } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import { RemoteConnection, RemoteFolder } from '../../definitions/RemoteConnection';
import { ReportLocation } from '../../definitions/Reports';
import createToastNotification, { ToastType } from '../../functions/createToastNotification';
import getRemoteSyncFailureAction, { RemoteSyncFailureAction } from '../../functions/getRemoteSyncFailureAction';
import getResponseError from '../../functions/getResponseError';
import getServerConfig from '../../functions/getServerConfig';
import isRemoteFolderOutdated from '../../functions/isRemoteFolderOutdated';
import notifyFolderSyncError from '../../functions/notifyFolderSyncError';
import notifyFolderSyncLocalFallback from '../../functions/notifyFolderSyncLocalFallback';
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

const LOCAL_SYNCED_REPORTS_TOAST_TITLE = 'Loaded local synced reports';
const LOCAL_SYNCED_REPORTS_TOAST_DETAIL = 'Remote host unreachable; showing reports already synced on this machine.';

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
        await loadLocalSyncedFolders(connection);
    };

    const loadLocalSyncedFolders = async (connection: RemoteConnection) => {
        const [localProfilerFolders, localPerformanceFolders] = await Promise.allSettled([
            connection.profilerPath ? remote.listLocalProfilerReports(connection) : Promise.resolve([]),
            connection.performancePath ? remote.listLocalPerformanceReports(connection) : Promise.resolve([]),
        ]);

        // Always replace cached lists on a successful scan — including []. Otherwise
        // never-synced / empty local dirs from an older remote fetch stay visible.
        if (localProfilerFolders.status === 'fulfilled') {
            updateSavedReportFolders(connection, localProfilerFolders.value);
        }

        if (localPerformanceFolders.status === 'fulfilled') {
            updateSavedPerformanceFolders(connection, localPerformanceFolders.value);
        }
    };

    const fetchRemoteFolderLists = async (connection: RemoteConnection) => {
        try {
            setIsFetching(true);

            const [reportFolders, performanceFolders] = await Promise.allSettled([
                connection.profilerPath ? remote.listProfilerReports(connection) : Promise.resolve([]),
                connection.performancePath ? remote.listPerformanceReports(connection) : Promise.resolve([]),
            ]);

            const fetchErrors: string[] = [];
            let usedLocalFallback = false;

            if (reportFolders.status === 'fulfilled') {
                updateSavedReportFolders(connection, reportFolders.value);
            } else if (connection.profilerPath) {
                try {
                    const localProfilerFolders = await remote.listLocalProfilerReports(connection);
                    updateSavedReportFolders(connection, localProfilerFolders);
                    if (localProfilerFolders.length > 0) {
                        usedLocalFallback = true;
                    } else {
                        fetchErrors.push(getResponseError(reportFolders.reason));
                    }
                } catch {
                    fetchErrors.push(getResponseError(reportFolders.reason));
                }
            }

            if (performanceFolders.status === 'fulfilled') {
                updateSavedPerformanceFolders(connection, performanceFolders.value);
            } else if (connection.performancePath) {
                try {
                    const localPerformanceFolders = await remote.listLocalPerformanceReports(connection);
                    updateSavedPerformanceFolders(connection, localPerformanceFolders);
                    if (localPerformanceFolders.length > 0) {
                        usedLocalFallback = true;
                    } else {
                        fetchErrors.push(getResponseError(performanceFolders.reason));
                    }
                } catch {
                    fetchErrors.push(getResponseError(performanceFolders.reason));
                }
            }

            if (usedLocalFallback) {
                createToastNotification(
                    LOCAL_SYNCED_REPORTS_TOAST_TITLE,
                    LOCAL_SYNCED_REPORTS_TOAST_DETAIL,
                    ToastType.WARNING,
                );
            }

            if (fetchErrors.length > 0) {
                createToastNotification('Folder list sync error', fetchErrors.join('; '), ToastType.ERROR);
            }
        } catch (err: unknown) {
            createToastNotification('Folder list sync error', getResponseError(err), ToastType.ERROR);
        } finally {
            setIsFetching(false);
        }
    };

    const updateSavedReportFolders = (connection: RemoteConnection, updatedFolders: RemoteFolder[]) => {
        if (!connection) {
            return [];
        }

        const savedFolders = remote.persistentState.getSavedReportFolders(connection);
        const mergedFolders = (updatedFolders ?? []).map((updatedFolder) => {
            const existingFolder = savedFolders?.find((f) => f.reportName === updatedFolder.reportName);

            return {
                ...existingFolder,
                ...updatedFolder,
                // Prefer fresh stamp from disk; keep cached value if the list response omitted it.
                lastSynced: updatedFolder.lastSynced ?? existingFolder?.lastSynced,
            };
        });

        remote.persistentState.setSavedReportFolders(connection, mergedFolders);
        setReportFolders(mergedFolders);

        return mergedFolders;
    };

    const updateSavedPerformanceFolders = (connection: RemoteConnection, updatedFolders: RemoteFolder[]) => {
        if (!connection) {
            return [];
        }

        const savedFolders = remote.persistentState.getSavedPerformanceFolders(connection);
        const mergedFolders = (updatedFolders ?? []).map((updatedFolder) => {
            const existingFolder = savedFolders?.find((f) => f.reportName === updatedFolder.reportName);

            return {
                ...existingFolder,
                ...updatedFolder,
                // Prefer fresh stamp from disk; keep cached value if the list response omitted it.
                lastSynced: updatedFolder.lastSynced ?? existingFolder?.lastSynced,
            };
        });

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

    const mountLocalProfilerFolderOnSyncFailure = async (selectedReport: RemoteFolder, err: unknown) => {
        const connection = remote.persistentState.selectedConnection;

        if (!connection) {
            notifyFolderSyncError(err);
            return;
        }

        try {
            const mountResponse = await remote.mountRemoteFolder(connection, selectedReport);

            if (mountResponse.status === 200) {
                applyProfilerReportSelection(selectedReport);
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

    const mountLocalPerformanceFolderOnSyncFailure = async (selectedReport: RemoteFolder, err: unknown) => {
        const connection = remote.persistentState.selectedConnection;

        if (!connection) {
            notifyFolderSyncError(err);
            return;
        }

        try {
            const mountResponse = await remote.mountRemoteFolder(connection, undefined, selectedReport);

            if (mountResponse.status === 200) {
                applyPerformanceReportSelection(selectedReport);
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

                    if (mountResponse.status === 200) {
                        updateReportSelection(updatedFolder);
                        queryClient.clear();
                    }
                }
            }
        } catch (err: unknown) {
            const failureAction = getRemoteSyncFailureAction(err, selectedReport);

            if (failureAction === RemoteSyncFailureAction.IGNORE_CANCEL) {
                return;
            }

            if (failureAction === RemoteSyncFailureAction.FALLBACK_LOCAL && selectedReport) {
                await mountLocalProfilerFolderOnSyncFailure(selectedReport, err);
                return;
            }

            notifyFolderSyncError(err);
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

                    if (mountResponse.status === 200) {
                        updatePerformanceSelection(updatedFolder);
                        queryClient.clear();
                    }
                }
            }
        } catch (err: unknown) {
            const failureAction = getRemoteSyncFailureAction(err, selectedReport);

            if (failureAction === RemoteSyncFailureAction.IGNORE_CANCEL) {
                return;
            }

            if (failureAction === RemoteSyncFailureAction.FALLBACK_LOCAL && selectedReport) {
                await mountLocalPerformanceFolderOnSyncFailure(selectedReport, err);
                return;
            }

            notifyFolderSyncError(err);
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
    useEffect(() => {
        if (disableRemoteSync) {
            return;
        }

        const connection = remote.persistentState.selectedConnection;

        if (connection) {
            loadLocalSyncedFolders(connection).catch(() => {
                // Local scan is best-effort; cached folders remain if it fails.
            });
        }
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

                            const response = await remote.mountRemoteFolder(
                                remote.persistentState.selectedConnection,
                                folder,
                            );

                            if (response.status === 200) {
                                updateReportSelection(folder);

                                if (hasBeenNormalised(folder)) {
                                    createDataIntegrityWarning(folder);
                                }
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

                            const response = await remote.mountRemoteFolder(
                                remote.persistentState.selectedConnection,
                                undefined,
                                folder,
                            );

                            if (response.status === 200) {
                                updatePerformanceSelection(folder);

                                if (hasBeenNormalised(folder)) {
                                    createDataIntegrityWarning(folder);
                                }
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
