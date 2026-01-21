// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FC, useEffect, useMemo, useState } from 'react';

import { FormGroup } from '@blueprintjs/core';
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useAtom } from 'jotai';
import { RemoteConnection, RemoteFolder } from '../../definitions/RemoteConnection';
import { ReportLocation } from '../../definitions/Reports';
import createToastNotification, { ToastType } from '../../functions/createToastNotification';
import getServerConfig from '../../functions/getServerConfig';
import isRemoteFolderOutdated from '../../functions/isRemoteFolderOutdated';
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
import { updateInstance } from '../../hooks/useAPI';
import { ActiveReport } from '../../model/APIData';

const GENERIC_ERROR_MESSAGE = 'An unknown error occurred.';

const RemoteSyncConfigurator: FC = () => {
    const remote = useRemoteConnection();
    const queryClient = useQueryClient();
    const disableRemoteSync = !!getServerConfig()?.SERVER_MODE;

    const [profilerReportLocation, setProfilerReportLocation] = useAtom(profilerReportLocationAtom);
    const [performanceReportLocation, setPerformanceReportLocation] = useAtom(performanceReportLocationAtom);
    const [activeProfilerReport, setActiveProfilerReport] = useAtom(activeProfilerReportAtom);
    const [activePerformanceReport, setActivePerformanceReport] = useAtom(activePerformanceReportAtom);

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
        remote.persistentState.selectedConnection = connection;
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

        await updateInstance({
            active_report: activeReport,
        });
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
        queryClient.clear();
        setProfilerReportLocation(ReportLocation.REMOTE);
        setActiveProfilerReport({
            path: folder.remotePath,
            reportName: folder.reportName,
        });
        createToastNotification('Active memory report', folder.reportName, ToastType.SUCCESS);
    };

    const updatePerformanceSelection = (folder: RemoteFolder) => {
        queryClient.clear();
        setPerformanceReportLocation(ReportLocation.REMOTE);
        setActivePerformanceReport({
            path: folder.remotePath,
            reportName: folder.reportName,
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
            const message = axios.isAxiosError(err) ? err.response?.data : GENERIC_ERROR_MESSAGE;

            createToastNotification('Folder sync error', message, ToastType.ERROR);
        } finally {
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
            const message = axios.isAxiosError(err) ? err.response?.data : GENERIC_ERROR_MESSAGE;

            createToastNotification('Folder sync error', message, ToastType.ERROR);
        } finally {
            setIsSyncingPerformanceFolder(false);
        }
    };

    const isProfilerRemote = profilerReportLocation === ReportLocation.REMOTE;
    const isPerformanceRemote = performanceReportLocation === ReportLocation.REMOTE;
    const isLoading = isSyncingReportFolder || isSyncingPerformanceFolder;
    const isDisabled = isFetching || isLoading || disableRemoteSync;

    // Populates the selectedReportFolder if there is a stored activeProfilerReport
    useEffect(() => {
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
                        remote.persistentState.savedConnectionList = [
                            ...remote.persistentState.savedConnectionList,
                            newConnection,
                        ];

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
                        remote.persistentState.savedConnectionList = updatedConnections;
                        remote.persistentState.updateSavedRemoteFoldersConnection(oldConnection, updatedConnection);

                        await updateSelectedConnection(updatedConnection);
                    }}
                    onRemoveConnection={async (connection) => {
                        const updatedConnections = [...remote.persistentState.savedConnectionList];

                        updatedConnections.splice(findConnectionIndex(connection), 1);
                        remote.persistentState.savedConnectionList = updatedConnections;
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
                                const [fetchedReportFolders, fetchedPerformanceFolders] = await Promise.all([
                                    remote.persistentState.selectedConnection.profilerPath
                                        ? remote.listReportFolders(remote.persistentState.selectedConnection)
                                        : [],
                                    remote.persistentState.selectedConnection.performancePath
                                        ? remote.listPerformanceFolders(remote.persistentState.selectedConnection)
                                        : [],
                                ]);

                                updateSavedReportFolders(
                                    remote.persistentState.selectedConnection,
                                    fetchedReportFolders,
                                );

                                updateSavedPerformanceFolders(
                                    remote.persistentState.selectedConnection,
                                    fetchedPerformanceFolders,
                                );
                            }
                        } catch (err: unknown) {
                            const message = axios.isAxiosError(err) ? err.response?.data : GENERIC_ERROR_MESSAGE;

                            createToastNotification('Folder list sync error', message, ToastType.ERROR);
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
                    remoteFolder={isProfilerRemote ? selectedReportFolder : undefined}
                    remoteFolderList={reportFolderList}
                    loading={isLoading || isFetching}
                    disabled={isDisabled}
                    onSelectFolder={async (folder) => {
                        if (remote.persistentState.selectedConnection) {
                            if (isRemoteFolderOutdated(folder)) {
                                setSelectedReportFolder(folder);
                                await syncSelectedReportFolder(folder);
                            } else {
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
                        }
                    }}
                    type='profiler'
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
                        if (remote.persistentState.selectedConnection) {
                            if (isRemoteFolderOutdated(folder)) {
                                setSelectedPerformanceFolder(folder);
                                await syncSelectedPerfReportFolder(folder);
                            } else {
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
