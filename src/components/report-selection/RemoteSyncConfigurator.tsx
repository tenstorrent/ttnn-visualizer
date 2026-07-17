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
import getResponseError from '../../functions/getResponseError';
import getServerConfig from '../../functions/getServerConfig';
import isRemoteFolderOutdated from '../../functions/isRemoteFolderOutdated';
import notifyFolderSyncError from '../../functions/notifyFolderSyncError';
import { createDataIntegrityWarning, hasBeenNormalised } from '../../functions/validateReportFolder';
import useRemoteConnection from '../../hooks/useRemote';
import useReportLinkBadges, { ReportLinkListScope } from '../../hooks/useReportLinkBadges';
import {
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    isReportSelectionPendingAtom,
    performanceReportLocationAtom,
    profilerReportLocationAtom,
    releaseReportSelection,
    tryAcquireReportSelection,
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
    const [isReportSelectionPending, setIsReportSelectionPending] = useAtom(isReportSelectionPendingAtom);

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
    const [isActivatingProfiler, setIsActivatingProfiler] = useState(false);
    const [selectedReportFolder, setSelectedReportFolder] = useState<RemoteFolder | undefined>(
        activeProfilerReport
            ? reportFolderList.find((folder) => folder.remotePath?.includes(activeProfilerReport.path))
            : undefined,
    );
    const [remotePerformanceFolderList, setRemotePerformanceFolders] = useState<RemoteFolder[]>(
        remote.persistentState.getSavedPerformanceFolders(remote.persistentState.selectedConnection),
    );
    const [isSyncingPerformanceFolder, setIsSyncingPerformanceFolder] = useState(false);
    const [isActivatingPerformance, setIsActivatingPerformance] = useState(false);
    const [selectedPerformanceFolder, setSelectedPerformanceFolder] = useState<RemoteFolder | undefined>(
        activePerformanceReport
            ? remotePerformanceFolderList.find((folder) =>
                  folder.reportName?.includes(activePerformanceReport?.reportName),
              )
            : remotePerformanceFolderList[0],
    );

    const beginReportSelection = () => {
        if (!tryAcquireReportSelection()) {
            return false;
        }

        setIsReportSelectionPending(true);
        return true;
    };

    const endReportSelection = () => {
        releaseReportSelection();
        setIsReportSelectionPending(false);
    };

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

    const updateReportSelection = (folder: RemoteFolder) => {
        setSelectedReportFolder(folder);
        setProfilerReportLocation(ReportLocation.REMOTE);
        setActiveProfilerReport({
            path: folder.remotePath,
            reportName: folder.reportName,
            host: remote.persistentState.selectedConnection?.host ?? null,
        });
        createToastNotification('Active memory report', folder.reportName, ToastType.SUCCESS);
    };

    const updatePerformanceSelection = (folder: RemoteFolder) => {
        setSelectedPerformanceFolder(folder);
        setPerformanceReportLocation(ReportLocation.REMOTE);
        setActivePerformanceReport({
            path: folder.remotePath,
            reportName: folder.reportName,
            host: remote.persistentState.selectedConnection?.host ?? null,
        });
        createToastNotification('Active performance report', folder.reportName, ToastType.SUCCESS);
    };

    const syncSelectedReportFolder = async (folder?: RemoteFolder) => {
        try {
            const selectedReport = folder ?? selectedReportFolder;

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
            notifyFolderSyncError(err);
        } finally {
            // REMOTE_SYNC registry clear is owned by syncRemoteFolder's finally.
            setIsSyncingReportFolder(false);
        }
    };

    const syncSelectedPerfReportFolder = async (folder?: RemoteFolder) => {
        try {
            const selectedReport = folder ?? selectedPerformanceFolder;

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
            notifyFolderSyncError(err);
        } finally {
            // REMOTE_SYNC registry clear is owned by syncRemoteFolder's finally.
            setIsSyncingPerformanceFolder(false);
        }
    };

    const handleSyncReportFolder = async (folder?: RemoteFolder) => {
        if (!beginReportSelection()) {
            return;
        }

        try {
            await syncSelectedReportFolder(folder);
        } finally {
            endReportSelection();
        }
    };

    const handleSyncPerfReportFolder = async (folder?: RemoteFolder) => {
        if (!beginReportSelection()) {
            return;
        }

        try {
            await syncSelectedPerfReportFolder(folder);
        } finally {
            endReportSelection();
        }
    };

    const isProfilerRemote = profilerReportLocation === ReportLocation.REMOTE;
    const isPerformanceRemote = performanceReportLocation === ReportLocation.REMOTE;
    const isActivatingReport = isActivatingProfiler || isActivatingPerformance;
    const isLoading = isSyncingReportFolder || isSyncingPerformanceFolder || isActivatingReport;
    const isDisabled = isFetching || isLoading || disableRemoteSync || isReportSelectionPending;

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

    const {
        linkedPerfPaths,
        unlinkedPerfPaths,
        linkedProfilerPaths: linkedProfilerReportPaths,
        unlinkedProfilerPaths: unlinkedProfilerReportPaths,
    } = useReportLinkBadges(ReportLinkListScope.REMOTE);

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
                        try {
                            setIsFetching(true);

                            if (remote.persistentState.selectedConnection) {
                                const [reportFolders, performanceFolders] = await Promise.allSettled([
                                    remote.persistentState.selectedConnection.profilerPath
                                        ? remote.listProfilerReports(remote.persistentState.selectedConnection)
                                        : Promise.resolve([]),
                                    remote.persistentState.selectedConnection.performancePath
                                        ? remote.listPerformanceReports(remote.persistentState.selectedConnection)
                                        : Promise.resolve([]),
                                ]);

                                const fetchErrors: string[] = [];

                                if (reportFolders.status === 'fulfilled') {
                                    updateSavedReportFolders(
                                        remote.persistentState.selectedConnection,
                                        reportFolders.value,
                                    );
                                } else {
                                    fetchErrors.push(getResponseError(reportFolders.reason));
                                }

                                if (performanceFolders.status === 'fulfilled') {
                                    updateSavedPerformanceFolders(
                                        remote.persistentState.selectedConnection,
                                        performanceFolders.value,
                                    );
                                } else {
                                    fetchErrors.push(getResponseError(performanceFolders.reason));
                                }

                                if (fetchErrors.length > 0) {
                                    createToastNotification(
                                        'Folder list sync error',
                                        fetchErrors.join('; '),
                                        ToastType.ERROR,
                                    );
                                }
                            }
                        } catch (err: unknown) {
                            createToastNotification('Folder list sync error', getResponseError(err), ToastType.ERROR);
                        } finally {
                            setIsFetching(false);
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
                    remoteFolder={isProfilerRemote || isActivatingProfiler ? selectedReportFolder : undefined}
                    remoteFolderList={reportFolderList}
                    loading={isActivatingProfiler || isSyncingReportFolder || isFetching}
                    disabled={isDisabled}
                    onSelectFolder={async (folder) => {
                        if (isDisabled || !remote.persistentState.selectedConnection || !beginReportSelection()) {
                            return;
                        }

                        const previousFolder = selectedReportFolder;
                        setSelectedReportFolder(folder);

                        try {
                            if (isRemoteFolderOutdated(folder)) {
                                await syncSelectedReportFolder(folder);
                                return;
                            }

                            setIsActivatingProfiler(true);

                            const response = await remote.mountRemoteFolder(
                                remote.persistentState.selectedConnection,
                                folder,
                            );

                            if (response.status === 200) {
                                updateReportSelection(folder);

                                if (hasBeenNormalised(folder)) {
                                    createDataIntegrityWarning(folder);
                                }
                            } else {
                                setSelectedReportFolder(previousFolder);
                                createToastNotification(
                                    'Unable to activate memory report',
                                    folder.reportName,
                                    ToastType.ERROR,
                                );
                            }
                        } catch (err: unknown) {
                            setSelectedReportFolder(previousFolder);
                            createToastNotification(
                                'Unable to activate memory report',
                                getResponseError(err, folder.reportName),
                                ToastType.ERROR,
                            );
                        } finally {
                            setIsActivatingProfiler(false);
                            endReportSelection();
                        }
                    }}
                    type='profiler'
                    showReportName
                    linkedPaths={linkedProfilerReportPaths}
                    unlinkedPaths={unlinkedProfilerReportPaths}
                >
                    {(isProfilerRemote || isSyncingReportFolder) && selectedReportFolder && (
                        <RemoteSyncButton
                            isDisabled={isDisabled}
                            selectedReportFolder={selectedReportFolder}
                            isSyncingReportFolder={isSyncingReportFolder}
                            isSelectedReportFolderOutdated={isSelectedReportFolderOutdated}
                            handleClick={handleSyncReportFolder}
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
                    remoteFolder={
                        isPerformanceRemote || isActivatingPerformance ? selectedPerformanceFolder : undefined
                    }
                    remoteFolderList={remotePerformanceFolderList}
                    loading={isActivatingPerformance || isSyncingPerformanceFolder || isFetching}
                    disabled={isDisabled}
                    onSelectFolder={async (folder) => {
                        if (isDisabled || !remote.persistentState.selectedConnection || !beginReportSelection()) {
                            return;
                        }

                        const previousFolder = selectedPerformanceFolder;
                        setSelectedPerformanceFolder(folder);

                        try {
                            if (isRemoteFolderOutdated(folder)) {
                                await syncSelectedPerfReportFolder(folder);
                                return;
                            }

                            setIsActivatingPerformance(true);

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
                            } else {
                                setSelectedPerformanceFolder(previousFolder);
                                createToastNotification(
                                    'Unable to activate performance report',
                                    folder.reportName,
                                    ToastType.ERROR,
                                );
                            }
                        } catch (err: unknown) {
                            setSelectedPerformanceFolder(previousFolder);
                            createToastNotification(
                                'Unable to activate performance report',
                                getResponseError(err, folder.reportName),
                                ToastType.ERROR,
                            );
                        } finally {
                            setIsActivatingPerformance(false);
                            endReportSelection();
                        }
                    }}
                    type='performance'
                    linkedPaths={linkedPerfPaths}
                    unlinkedPaths={unlinkedPerfPaths}
                >
                    {(isPerformanceRemote || isSyncingPerformanceFolder) && selectedPerformanceFolder && (
                        <RemoteSyncButton
                            isDisabled={isDisabled}
                            selectedReportFolder={selectedPerformanceFolder}
                            isSyncingReportFolder={isSyncingPerformanceFolder}
                            isSelectedReportFolderOutdated={isSelectedPerfFolderOutdated}
                            handleClick={handleSyncPerfReportFolder}
                        />
                    )}
                </RemoteFolderSelector>
            </FormGroup>
        </>
    );
};

export default RemoteSyncConfigurator;
