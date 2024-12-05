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

    const [reportFolderList, setReportFolders] = useState<RemoteFolder[]>(
        remote.persistentState.getSavedReportFolders(remote.persistentState.selectedConnection),
    );
    const [isSyncingReportFolder, setIsSyncingReportFolder] = useState(false);
    const [isLoadingFolderList, setIsLoadingFolderList] = useState(false);
    const [isFetchingFolderStatus, setIsFetchingFolderStatus] = useState(false);
    const [selectedReportFolder, setSelectedReportFolder] = useState<RemoteFolder | undefined>(reportFolderList[0]);

    const [remotePerformanceFolderList, setRemotePerformanceFolders] = useState<RemoteFolder[]>(
        remote.persistentState.getSavedPerformanceFolders(remote.persistentState.selectedConnection),
    );
    const [isSyncingPerformanceFolder, setIsSyncingPerformanceFolder] = useState(false);
    const [isLoadingPerformanceFolderList, _setIsLoadingPerformanceFolderList] = useState(false);
    const [isFetchingPerformanceFolderStatus, _setIsFetchingPerformanceFolderStatus] = useState(false);
    const [selectedPerformanceFolder, setSelectedPerformanceFolder] = useState<RemoteFolder | undefined>(
        reportFolderList[0],
    );

    const updateSelectedConnection = (connection: RemoteConnection) => {
        remote.persistentState.selectedConnection = connection;
        setReportFolders(remote.persistentState.getSavedReportFolders(connection));
        setRemotePerformanceFolders(remote.persistentState.getSavedPerformanceFolders(connection));

        setSelectedReportFolder(remote.persistentState.getSavedReportFolders(connection)[0]);
        setSelectedPerformanceFolder(remote.persistentState.getSavedPerformanceFolders(connection)[0]);
    };

    const updateSavedRemoteFolders = (connection: RemoteConnection | undefined, updatedFolders: RemoteFolder[]) => {
        if (!connection) {
            return [];
        }

        const savedFolders = remote.persistentState.getSavedReportFolders(connection);
        const mergedFolders = (updatedFolders ?? []).map((updatedFolder) => {
            const existingFolder = savedFolders?.find((f) => f.localPath === updatedFolder.localPath);

            return {
                ...existingFolder,
                ...updatedFolder,
            } as RemoteFolder;
        });

        remote.persistentState.setSavedReportFolders(connection, mergedFolders);
        setReportFolders(mergedFolders);

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

    const isRemoteReportMounted =
        !isSyncingReportFolder &&
        !isSyncingPerformanceFolder &&
        !isLoadingFolderList &&
        reportFolderList?.length > 0 &&
        selectedReportFolder &&
        (isUsingRemoteQuerying || !isRemoteFolderOutdated(selectedReportFolder));

    const isThinking = isSyncingReportFolder || isSyncingPerformanceFolder || isLoadingFolderList;

    useEffect(() => {
        (async () => {
            try {
                setIsFetchingFolderStatus(true);
                const updatedRemoteFolders = await remote.listRemoteFolders(remote.persistentState.selectedConnection);

                setIsRemoteOffline(false);
                updateSavedRemoteFolders(remote.persistentState.selectedConnection!, updatedRemoteFolders);
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
                setIsFetchingFolderStatus(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <>
            <FormGroup
                label={<h3>Add remote sync server</h3>}
                labelFor='text-input'
                subLabel='Add new server connection details'
            >
                <AddRemoteConnection
                    disabled={isThinking}
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
                labelFor='text-input'
                subLabel='Select remote server that will be used for syncing folders'
            >
                <RemoteConnectionSelector
                    connection={remote.persistentState.selectedConnection}
                    connectionList={remote.persistentState.savedConnectionList}
                    disabled={isThinking}
                    loading={isLoadingFolderList}
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
                    }}
                    onSelectConnection={async (connection) => {
                        try {
                            setIsFetchingFolderStatus(true);
                            updateSelectedConnection(connection);

                            const fetchedRemoteFolders = await remote.listRemoteFolders(connection);
                            const updatedFolders = updateSavedRemoteFolders(connection, fetchedRemoteFolders);

                            setIsRemoteOffline(false);
                            setSelectedReportFolder(updatedFolders[0]);
                        } catch {
                            setIsRemoteOffline(true);
                        } finally {
                            setIsFetchingFolderStatus(false);
                        }
                    }}
                    onSyncRemoteFolderList={async () => {
                        try {
                            setIsLoadingFolderList(true);

                            const savedRemotefolders = await remote.listRemoteFolders(
                                remote.persistentState.selectedConnection,
                            );

                            const updatedfolders = updateSavedRemoteFolders(
                                remote.persistentState.selectedConnection,
                                savedRemotefolders,
                            );

                            setSelectedReportFolder(updatedfolders[0]);
                        } catch (err) {
                            // eslint-disable-next-line no-alert
                            alert('Unable to connect to remote server.');
                        } finally {
                            setIsLoadingFolderList(false);
                        }
                    }}
                />
            </FormGroup>

            <FormGroup
                label={<h3>Select report folder</h3>}
                labelFor='text-input'
            >
                <RemoteFolderSelector
                    remoteFolder={selectedReportFolder}
                    remoteFolderList={reportFolderList}
                    loading={isSyncingReportFolder || isLoadingFolderList}
                    updatingFolderList={isFetchingFolderStatus}
                    onSelectFolder={(folder) => {
                        setSelectedReportFolder(folder);
                    }}
                >
                    {!isUsingRemoteQuerying && (
                        <Tooltip content='Sync remote folder'>
                            <AnchorButton
                                icon={IconNames.REFRESH}
                                loading={isSyncingReportFolder}
                                disabled={isThinking || !selectedReportFolder || reportFolderList?.length === 0}
                                onClick={async () => {
                                    try {
                                        setIsSyncingReportFolder(true);
                                        const { data: updatedFolder } = await remote.syncRemoteFolder(
                                            remote.persistentState.selectedConnection,
                                            selectedReportFolder,
                                        );

                                        const savedRemoteFolders = remote.persistentState.getSavedReportFolders(
                                            remote.persistentState.selectedConnection,
                                        );

                                        const updatedFolderIndex = savedRemoteFolders.findIndex(
                                            (f) => f.localPath === selectedReportFolder?.localPath,
                                        );

                                        savedRemoteFolders[updatedFolderIndex] = updatedFolder;

                                        updateSavedRemoteFolders(
                                            remote.persistentState.selectedConnection,
                                            savedRemoteFolders,
                                        );

                                        setSelectedReportFolder(savedRemoteFolders[updatedFolderIndex]);
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
                label={<h3>Select performance folder</h3>}
                labelFor='text-input'
            >
                <RemoteFolderSelector
                    remoteFolder={selectedPerformanceFolder}
                    remoteFolderList={remotePerformanceFolderList}
                    loading={isSyncingPerformanceFolder || isLoadingPerformanceFolderList}
                    updatingFolderList={isFetchingPerformanceFolderStatus}
                    onSelectFolder={setSelectedPerformanceFolder}
                >
                    {!isUsingRemoteQuerying && (
                        <Tooltip content='Sync remote folder'>
                            <AnchorButton
                                icon={IconNames.REFRESH}
                                loading={isSyncingPerformanceFolder}
                                disabled={
                                    isThinking ||
                                    !selectedPerformanceFolder ||
                                    remotePerformanceFolderList?.length === 0
                                }
                                onClick={async () => {
                                    try {
                                        setIsSyncingPerformanceFolder(true);
                                        const { data: updatedFolder } = await remote.syncRemoteFolder(
                                            remote.persistentState.selectedConnection,
                                            selectedPerformanceFolder,
                                        );

                                        const savedRemoteFolders = remote.persistentState.getSavedReportFolders(
                                            remote.persistentState.selectedConnection,
                                        );

                                        const updatedFolderIndex = savedRemoteFolders.findIndex(
                                            (f) => f.localPath === selectedPerformanceFolder?.localPath,
                                        );

                                        savedRemoteFolders[updatedFolderIndex] = updatedFolder;

                                        updateSavedRemoteFolders(
                                            remote.persistentState.selectedConnection,
                                            savedRemoteFolders,
                                        );

                                        setSelectedPerformanceFolder(savedRemoteFolders[updatedFolderIndex]);
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
