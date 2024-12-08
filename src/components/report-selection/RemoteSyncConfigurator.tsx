// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FC, useEffect, useState } from 'react';

import { AnchorButton, Button, FormGroup, Tooltip } from '@blueprintjs/core';

import { IconNames } from '@blueprintjs/icons';
import { useAtom, useSetAtom } from 'jotai';
import { useQueryClient } from 'react-query';
import { useNavigate } from 'react-router';
import { RemoteConnection, RemoteFolder } from '../../definitions/RemoteConnection';
import ROUTES from '../../definitions/routes';
import isRemoteFolderOutdated from '../../functions/isRemoteFolderOutdated';
import useRemote from '../../hooks/useRemote';
import { reportLocationAtom, selectedDeviceAtom } from '../../store/app';
import AddRemoteConnection from './AddRemoteConnection';
import RemoteConnectionSelector from './RemoteConnectionSelector';
import RemoteFolderSelector from './RemoteFolderSelector';

const RemoteSyncConfigurator: FC = () => {
    const remote = useRemote();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const [_, setReportLocation] = useAtom(reportLocationAtom);
    const setSelectedDevice = useSetAtom(selectedDeviceAtom);
    const [isRemoteOffline, setIsRemoteOffline] = useState(false);

    const [isFetching, setIsFetching] = useState(false);

    const [reportFolderList, setReportFolders] = useState<RemoteFolder[]>(
        remote.persistentState.getSavedReportFolders(remote.persistentState.selectedConnection),
    );
    const [isSyncingReportFolder, setIsSyncingReportFolder] = useState(false);
    const [selectedReportFolder, setSelectedReportFolder] = useState<RemoteFolder | undefined>(reportFolderList[0]);

    const [remotePerformanceFolderList, setRemotePerformanceFolders] = useState<RemoteFolder[]>(
        remote.persistentState.getSavedPerformanceFolders(remote.persistentState.selectedConnection),
    );
    const [isSyncingPerformanceFolder, setIsSyncingPerformanceFolder] = useState(false);
    const [selectedPerformanceFolder, setSelectedPerformanceFolder] = useState<RemoteFolder | undefined>(
        remotePerformanceFolderList[0],
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
            const existingFolder = savedFolders?.find((f) => f.remotePath === updatedFolder.remotePath);

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

        const savedFolders = remote.persistentState.getSavedReportFolders(connection);
        const mergedFolders = (updatedFolders ?? []).map((updatedFolder) => {
            const existingFolder = savedFolders?.find((f) => f.remotePath === updatedFolder.remotePath);

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

    const viewReport = async () => {
        if (remote.persistentState.selectedConnection && selectedReportFolder) {
            const response = await remote.mountRemoteFolder(
                remote.persistentState.selectedConnection,
                selectedReportFolder,
                selectedPerformanceFolder,
            );

            if (response.status === 200) {
                queryClient.clear();
                setReportLocation('remote');
                setSelectedDevice(0);

                navigate(ROUTES.OPERATIONS);
            }
        }
    };

    const isUsingRemoteQuerying = remote.persistentState.selectedConnection?.useRemoteQuerying;
    const isLoading = isSyncingReportFolder || isSyncingPerformanceFolder;
    const isDisabled = isFetching || isLoading;

    const isRemoteReportMounted =
        !isDisabled &&
        reportFolderList?.length > 0 &&
        selectedReportFolder &&
        (isUsingRemoteQuerying || !isRemoteFolderOutdated(selectedReportFolder));

    useEffect(() => {
        (async () => {
            try {
                setIsFetching(true);

                const updatedRemoteFolders = await remote.listReportFolders(remote.persistentState.selectedConnection);
                const updatedPerformanceFolders = await remote.listPerformanceFolders(
                    remote.persistentState.selectedConnection,
                );

                setIsRemoteOffline(false);
                updateSavedReportFolders(remote.persistentState.selectedConnection!, updatedRemoteFolders);
                updateSavedPerformanceFolders(remote.persistentState.selectedConnection!, updatedPerformanceFolders);

                // Update existing folder
                if (selectedReportFolder) {
                    const updatedSelectedFolder = updatedRemoteFolders.find(
                        (f) => f.remotePath === selectedReportFolder?.remotePath,
                    );
                    if (updatedSelectedFolder) {
                        setSelectedReportFolder(updatedSelectedFolder);
                    }
                }
            } catch {
                setIsRemoteOffline(true);
            } finally {
                setIsFetching(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <>
            <FormGroup
                label={<h3>Add remote sync server</h3>}
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
                label={<h3>Use remote sync server</h3>}
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
                        remote.persistentState.deleteSavedRemoteFolders(connection);

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
                label={<h3>Report folder</h3>}
                subLabel='Select the report folder you wish to view'
            >
                <RemoteFolderSelector
                    remoteFolder={selectedReportFolder}
                    remoteFolderList={reportFolderList}
                    loading={isLoading || isFetching}
                    updatingFolderList={isFetching}
                    onSelectFolder={setSelectedReportFolder}
                >
                    {!isUsingRemoteQuerying && (
                        <Tooltip content='Sync remote folder'>
                            <AnchorButton
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

                                            const savedRemoteFolders = remote.persistentState.getSavedReportFolders(
                                                remote.persistentState.selectedConnection,
                                            );

                                            const updatedFolderIndex = savedRemoteFolders.findIndex(
                                                (f) => f.remotePath === selectedReportFolder?.remotePath,
                                            );

                                            savedRemoteFolders[updatedFolderIndex] = updatedFolder;

                                            updateSavedReportFolders(
                                                remote.persistentState.selectedConnection,
                                                savedRemoteFolders,
                                            );

                                            setSelectedReportFolder(savedRemoteFolders[updatedFolderIndex]);
                                        }
                                    } catch {
                                        // eslint-disable-next-line no-alert
                                        alert('Unable to sync remote folder');
                                    } finally {
                                        setIsSyncingReportFolder(false);
                                        setReportLocation('remote');
                                    }
                                }}
                            />
                        </Tooltip>
                    )}
                </RemoteFolderSelector>
            </FormGroup>

            <FormGroup
                label={<h3>Performance data folder</h3>}
                subLabel='Select the performance data folder you wish to view'
            >
                <RemoteFolderSelector
                    remoteFolder={selectedPerformanceFolder}
                    remoteFolderList={remotePerformanceFolderList}
                    loading={isLoading || isFetching}
                    updatingFolderList={isFetching}
                    onSelectFolder={setSelectedPerformanceFolder}
                >
                    {!isUsingRemoteQuerying && (
                        <Tooltip content='Sync remote folder'>
                            <AnchorButton
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
                                                selectedPerformanceFolder,
                                            );

                                            const savedRemoteFolders = remote.persistentState.getSavedReportFolders(
                                                remote.persistentState.selectedConnection,
                                            );

                                            const updatedFolderIndex = savedRemoteFolders.findIndex(
                                                (f) => f.remotePath === selectedPerformanceFolder?.remotePath,
                                            );

                                            savedRemoteFolders[updatedFolderIndex] = updatedFolder;

                                            updateSavedReportFolders(
                                                remote.persistentState.selectedConnection,
                                                savedRemoteFolders,
                                            );

                                            setSelectedPerformanceFolder(savedRemoteFolders[updatedFolderIndex]);
                                        }
                                    } catch {
                                        // eslint-disable-next-line no-alert
                                        alert('Unable to sync remote folder');
                                    } finally {
                                        setIsSyncingPerformanceFolder(false);
                                        setReportLocation('remote');
                                    }
                                }}
                            />
                        </Tooltip>
                    )}
                </RemoteFolderSelector>
            </FormGroup>

            <FormGroup>
                <Button
                    disabled={!isRemoteReportMounted}
                    onClick={viewReport}
                    icon={IconNames.EYE_OPEN}
                >
                    View report
                </Button>
            </FormGroup>
        </>
    );
};

export default RemoteSyncConfigurator;
