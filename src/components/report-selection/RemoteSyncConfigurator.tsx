// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FC, useState } from 'react';

import { Button, FormGroup, Tooltip } from '@blueprintjs/core';

import { IconNames } from '@blueprintjs/icons';
import { useAtom, useSetAtom } from 'jotai';
import { useQueryClient } from '@tanstack/react-query';
import { DEFAULT_DEVICE_ID } from '../../definitions/Devices';
import getFolderNameFromPath from '../../definitions/getFolderNameFromPath';
import { RemoteConnection, RemoteFolder } from '../../definitions/RemoteConnection';
import createToastNotification from '../../functions/createToastNotification';
import getServerConfig from '../../functions/getServerConfig';
import isRemoteFolderOutdated from '../../functions/isRemoteFolderOutdated';
import useRemote from '../../hooks/useRemote';
import {
    ReportLocation,
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    performanceReportLocationAtom,
    profilerReportLocationAtom,
    selectedDeviceAtom,
} from '../../store/app';
import AddRemoteConnection from './AddRemoteConnection';
import RemoteConnectionSelector from './RemoteConnectionSelector';
import RemoteFolderSelector from './RemoteFolderSelector';
import { createDataIntegrityWarning, hasBeenNormalised } from '../../functions/validateReportFolder';

const RemoteSyncConfigurator: FC = () => {
    const remote = useRemote();
    const queryClient = useQueryClient();
    const disableRemoteSync = !!getServerConfig()?.SERVER_MODE;

    const setProfilerReportLocation = useSetAtom(profilerReportLocationAtom);
    const setPerformanceReportLocation = useSetAtom(performanceReportLocationAtom);
    const setSelectedDevice = useSetAtom(selectedDeviceAtom);
    const [activeProfilerReport, setActiveProfilerReport] = useAtom(activeProfilerReportAtom);
    const [activePerformanceReport, setActivePerformanceReport] = useAtom(activePerformanceReportAtom);
    const [isRemoteOffline, setIsRemoteOffline] = useState(false);

    const [isFetching, setIsFetching] = useState(false);

    const [reportFolderList, setReportFolders] = useState<RemoteFolder[]>(
        remote.persistentState.getSavedReportFolders(remote.persistentState.selectedConnection),
    );
    const [isSyncingReportFolder, setIsSyncingReportFolder] = useState(false);
    const [selectedReportFolder, setSelectedReportFolder] = useState<RemoteFolder | undefined>(
        activeProfilerReport
            ? reportFolderList.find((folder) => folder.remotePath?.includes(activeProfilerReport))
            : reportFolderList[0],
    );

    const [remotePerformanceFolderList, setRemotePerformanceFolders] = useState<RemoteFolder[]>(
        remote.persistentState.getSavedPerformanceFolders(remote.persistentState.selectedConnection),
    );
    const [isSyncingPerformanceFolder, setIsSyncingPerformanceFolder] = useState(false);
    const [selectedPerformanceFolder, setSelectedPerformanceFolder] = useState<RemoteFolder | undefined>(
        activePerformanceReport
            ? remotePerformanceFolderList.find((folder) => folder.reportName?.includes(activePerformanceReport))
            : remotePerformanceFolderList[0],
    );

    const updateSelectedConnection = (connection: RemoteConnection) => {
        remote.persistentState.selectedConnection = connection;
        setReportFolders(remote.persistentState.getSavedReportFolders(connection));
        setRemotePerformanceFolders(remote.persistentState.getSavedPerformanceFolders(connection));

        setSelectedReportFolder(remote.persistentState.getSavedReportFolders(connection)[0]);
        setSelectedPerformanceFolder(remote.persistentState.getSavedPerformanceFolders(connection)[0]);
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
            } as RemoteFolder;
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
            } as RemoteFolder;
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

    const isLoading = isSyncingReportFolder || isSyncingPerformanceFolder;
    const isDisabled = isFetching || isLoading || disableRemoteSync;

    const updateReportSelection = (folder: RemoteFolder) => {
        queryClient.clear();
        setProfilerReportLocation(ReportLocation.REMOTE);
        setSelectedDevice(DEFAULT_DEVICE_ID);
        setActiveProfilerReport(getFolderNameFromPath(folder.remotePath));
        createToastNotification('Active memory report', folder.reportName);
    };

    const updatePerformanceSelection = (fileName: string) => {
        queryClient.clear();
        setPerformanceReportLocation(ReportLocation.REMOTE);
        setSelectedDevice(DEFAULT_DEVICE_ID);
        setActivePerformanceReport(fileName);
        createToastNotification('Active performance report', fileName);
    };

    return (
        <>
            <FormGroup
                className='form-group'
                label={<h3 className='label'>Add remote sync server</h3>}
                subLabel='Add new server connection details'
            >
                <AddRemoteConnection
                    disabled={isDisabled}
                    onAddConnection={(newConnection) => {
                        remote.persistentState.savedConnectionList = [
                            ...remote.persistentState.savedConnectionList,
                            newConnection,
                        ];

                        updateSelectedConnection(newConnection);
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
                    offline={isRemoteOffline}
                    onEditConnection={(updatedConnection, oldConnection) => {
                        const updatedConnections = [...remote.persistentState.savedConnectionList];

                        updatedConnections[findConnectionIndex(oldConnection)] = updatedConnection;
                        remote.persistentState.savedConnectionList = updatedConnections;
                        remote.persistentState.updateSavedRemoteFoldersConnection(oldConnection, updatedConnection);

                        updateSelectedConnection(updatedConnection);
                    }}
                    onRemoveConnection={(connection) => {
                        const updatedConnections = [...remote.persistentState.savedConnectionList];

                        updatedConnections.splice(findConnectionIndex(connection), 1);
                        remote.persistentState.savedConnectionList = updatedConnections;
                        remote.persistentState.deleteSavedReportFolders(connection);
                        remote.persistentState.deleteSavedPerformanceFolders(connection);

                        updateSelectedConnection(updatedConnections[0]);
                        setSelectedReportFolder(undefined);
                        setSelectedPerformanceFolder(undefined);
                    }}
                    onSelectConnection={async (connection) => {
                        try {
                            setIsFetching(true);

                            updateSelectedConnection(connection);

                            const fetchedReportFolders = await remote.listReportFolders(connection);
                            const fetchedPerformanceFolders = connection.performancePath
                                ? await remote.listPerformanceFolders(connection)
                                : [];

                            const updatedReportFolders = updateSavedReportFolders(connection, fetchedReportFolders);
                            const updatedPerformanceFolders = updateSavedPerformanceFolders(
                                connection,
                                fetchedPerformanceFolders,
                            );

                            setIsRemoteOffline(false);
                            setSelectedReportFolder(updatedReportFolders[0]);
                            setSelectedPerformanceFolder(updatedPerformanceFolders[0]);
                        } catch {
                            setIsRemoteOffline(true);
                        } finally {
                            setIsFetching(false);
                        }
                    }}
                    onSyncRemoteFolderList={async () => {
                        try {
                            setIsFetching(true);

                            if (remote.persistentState.selectedConnection) {
                                const fetchedReportFolders = await remote.listReportFolders(
                                    remote.persistentState.selectedConnection,
                                );
                                const fetchedPerformanceFolders = remote.persistentState.selectedConnection
                                    .performancePath
                                    ? await remote.listPerformanceFolders(remote.persistentState.selectedConnection)
                                    : [];

                                const updatedReportsfolders = updateSavedReportFolders(
                                    remote.persistentState.selectedConnection,
                                    fetchedReportFolders,
                                );
                                const updatedPerformanceFolders = updateSavedPerformanceFolders(
                                    remote.persistentState.selectedConnection,
                                    fetchedPerformanceFolders,
                                );

                                setSelectedReportFolder(updatedReportsfolders[0]);
                                setSelectedPerformanceFolder(updatedPerformanceFolders[0]);
                            }
                            // eslint-disable-next-line @typescript-eslint/no-unused-vars
                        } catch (err) {
                            // eslint-disable-next-line no-alert
                            alert('Unable to connect to remote server.');
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
                    remoteFolder={selectedReportFolder}
                    remoteFolderList={reportFolderList}
                    loading={isLoading || isFetching}
                    updatingFolderList={isFetching}
                    disabled={isDisabled}
                    onSelectFolder={async (folder) => {
                        setSelectedReportFolder(folder);

                        if (remote.persistentState.selectedConnection && !isRemoteFolderOutdated(folder)) {
                            const response = await remote.mountRemoteFolder(
                                remote.persistentState.selectedConnection,
                                folder,
                                selectedPerformanceFolder,
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
                >
                    <Tooltip content='Sync remote folder'>
                        <Button
                            aria-label='Sync remote folder'
                            icon={IconNames.REFRESH}
                            loading={isSyncingReportFolder}
                            disabled={isDisabled || !selectedReportFolder || reportFolderList?.length === 0}
                            onClick={async () => {
                                try {
                                    setIsSyncingReportFolder(true);

                                    if (remote.persistentState.selectedConnection) {
                                        const { data: updatedFolder } = await remote.syncRemoteFolder(
                                            remote.persistentState.selectedConnection,
                                            selectedReportFolder,
                                        );

                                        if (hasBeenNormalised(updatedFolder)) {
                                            createDataIntegrityWarning(updatedFolder);
                                        }

                                        const savedRemoteFolders = remote.persistentState.getSavedReportFolders(
                                            remote.persistentState.selectedConnection,
                                        );

                                        const updatedFolderIndex = savedRemoteFolders.findIndex(
                                            (f) => f.reportName === selectedReportFolder?.reportName,
                                        );

                                        savedRemoteFolders[updatedFolderIndex] = updatedFolder;

                                        updateSavedReportFolders(
                                            remote.persistentState.selectedConnection,
                                            savedRemoteFolders,
                                        );

                                        setSelectedReportFolder(savedRemoteFolders[updatedFolderIndex]);

                                        if (remote.persistentState.selectedConnection && selectedReportFolder) {
                                            const mountResponse = await remote.mountRemoteFolder(
                                                remote.persistentState.selectedConnection,
                                                selectedReportFolder,
                                            );

                                            if (mountResponse.status === 200) {
                                                updateReportSelection(selectedReportFolder);
                                                queryClient.clear();
                                            }
                                        }
                                    }
                                } catch {
                                    // eslint-disable-next-line no-alert
                                    alert('Unable to sync remote folder');
                                } finally {
                                    setIsSyncingReportFolder(false);
                                }
                            }}
                        />
                    </Tooltip>
                </RemoteFolderSelector>
            </FormGroup>

            {
                <FormGroup
                    className='form-group'
                    label={<h3 className='label'>Performance report</h3>}
                    subLabel='Select a performance report'
                >
                    <RemoteFolderSelector
                        remoteFolder={selectedPerformanceFolder}
                        remoteFolderList={remotePerformanceFolderList}
                        loading={isLoading || isFetching}
                        updatingFolderList={isFetching}
                        disabled={isDisabled}
                        onSelectFolder={async (folder) => {
                            setSelectedPerformanceFolder(folder);

                            if (remote.persistentState.selectedConnection && !isRemoteFolderOutdated(folder)) {
                                const response = await remote.mountRemoteFolder(
                                    remote.persistentState.selectedConnection,
                                    selectedReportFolder,
                                    folder,
                                );

                                if (response.status === 200) {
                                    const fileName = folder.remotePath;

                                    updatePerformanceSelection(fileName);
                                }
                            }
                        }}
                        type='performance'
                    >
                        <Tooltip content='Sync remote folder'>
                            <Button
                                aria-label='Sync remote folder'
                                icon={IconNames.REFRESH}
                                loading={isSyncingPerformanceFolder}
                                disabled={
                                    isDisabled ||
                                    !selectedPerformanceFolder ||
                                    remotePerformanceFolderList?.length === 0
                                }
                                onClick={async () => {
                                    try {
                                        setIsSyncingPerformanceFolder(true);

                                        if (remote.persistentState.selectedConnection) {
                                            const { data: updatedFolder } = await remote.syncRemoteFolder(
                                                remote.persistentState.selectedConnection,
                                                undefined,
                                                selectedPerformanceFolder,
                                            );

                                            const savedRemoteFolders =
                                                remote.persistentState.getSavedPerformanceFolders(
                                                    remote.persistentState.selectedConnection,
                                                );

                                            const updatedFolderIndex = savedRemoteFolders.findIndex(
                                                (f) => f.reportName === selectedPerformanceFolder?.reportName,
                                            );

                                            savedRemoteFolders[updatedFolderIndex] = updatedFolder;

                                            updateSavedPerformanceFolders(
                                                remote.persistentState.selectedConnection,
                                                savedRemoteFolders,
                                            );

                                            setSelectedPerformanceFolder(savedRemoteFolders[updatedFolderIndex]);

                                            if (
                                                remote.persistentState.selectedConnection &&
                                                selectedPerformanceFolder &&
                                                isRemoteFolderOutdated(selectedPerformanceFolder)
                                            ) {
                                                const response = await remote.mountRemoteFolder(
                                                    remote.persistentState.selectedConnection,
                                                    undefined,
                                                    selectedPerformanceFolder,
                                                );

                                                if (response.status === 200) {
                                                    const fileName = selectedPerformanceFolder.reportName;

                                                    updatePerformanceSelection(fileName);
                                                }
                                            }
                                        }
                                    } catch {
                                        // eslint-disable-next-line no-alert
                                        alert('Unable to sync remote folder');
                                    } finally {
                                        setIsSyncingPerformanceFolder(false);
                                    }
                                }}
                            />
                        </Tooltip>
                    </RemoteFolderSelector>
                </FormGroup>
            }
        </>
    );
};

export default RemoteSyncConfigurator;
