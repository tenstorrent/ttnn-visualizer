// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FC, useEffect, useState } from 'react';

import { AnchorButton, Button, FormGroup, Tooltip } from '@blueprintjs/core';

import { useNavigate } from 'react-router';
import { IconNames } from '@blueprintjs/icons';
import { useQueryClient } from 'react-query';
import useRemote from '../../hooks/useRemote';
import AddRemoteConnection from './AddRemoteConnection';
import RemoteFolderSelector from './RemoteFolderSelector';
import RemoteConnectionSelector from './RemoteConnectionSelector';
import ROUTES from '../../definitions/routes';
import isLocalFolderOutdated from '../../functions/isLocalFolderOutdated';
import { Connection, ReportFolder } from '../../model/Connection';

const RemoteSyncConfigurator: FC = () => {
    const remote = useRemote();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [remoteFolderList, setRemoteFolders] = useState<ReportFolder[]>(
        remote.persistentState.getSavedRemoteFolders(remote.persistentState.selectedConnection),
    );

    const [isSyncingRemoteFolder, setIsSyncingRemoteFolder] = useState(false);
    const [isLoadingFolderList, setIsLoadingFolderList] = useState(false);
    const [isFetchingFolderStatus, setIsFetchingFolderStatus] = useState(false);
    const [isRemoteOffline, setIsRemoteOffline] = useState(false);
    const [selectedRemoteFolder, setSelectedRemoteFolder] = useState<ReportFolder | undefined>(remoteFolderList[0]);

    const updateSelectedConnection = (connection: Connection) => {
        remote.persistentState.selectedConnection = connection;
        setRemoteFolders(remote.persistentState.getSavedRemoteFolders(connection));

        setSelectedRemoteFolder(remote.persistentState.getSavedRemoteFolders(connection)[0]);
    };

    const updateSavedRemoteFolders = (connection: Connection | undefined, updatedFolders: ReportFolder[]) => {
        if (!connection) {
            return [];
        }

        const savedFolders = remote.persistentState.getSavedRemoteFolders(connection);
        const mergedFolders = (updatedFolders ?? []).map((updatedFolder) => {
            const existingFolder = savedFolders?.find((f) => f.localPath === updatedFolder.localPath);

            return {
                ...existingFolder,
                ...updatedFolder,
            } as ReportFolder;
        });

        remote.persistentState.setSavedRemoteFolders(connection, mergedFolders);
        setRemoteFolders(mergedFolders);

        return mergedFolders;
    };

    const findConnectionIndex = (connection?: Connection) => {
        return remote.persistentState.savedConnectionList.findIndex((c) => {
            const isSameName = c.name === connection?.name;
            const isSameHost = c.host === connection?.host;
            const isSamePort = c.port === connection?.port;

            return isSameName && isSameHost && isSamePort;
        });
    };

    const viewReport = async () => {
        if (remote.persistentState.selectedConnection && selectedRemoteFolder) {
            const response = await remote.mountRemoteFolder(
                remote.persistentState.selectedConnection,
                selectedRemoteFolder,
            );

            queryClient.clear();

            if (response.status === 200) {
                navigate(ROUTES.OPERATIONS);
            }
        }
    };

    const isViewReportDisabled =
        isSyncingRemoteFolder ||
        isLoadingFolderList ||
        remoteFolderList?.length === 0 ||
        (selectedRemoteFolder && isLocalFolderOutdated(selectedRemoteFolder));

    useEffect(() => {
        (async () => {
            try {
                setIsFetchingFolderStatus(true);
                const updatedRemoteFolders = await remote.listRemoteFolders(remote.persistentState.selectedConnection);

                setIsRemoteOffline(false);
                updateSavedRemoteFolders(remote.persistentState.selectedConnection!, updatedRemoteFolders);
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
                    disabled={isLoadingFolderList || isSyncingRemoteFolder}
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
                    disabled={isLoadingFolderList || isSyncingRemoteFolder}
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
                        setSelectedRemoteFolder(undefined);
                    }}
                    onSelectConnection={async (connection) => {
                        try {
                            setIsFetchingFolderStatus(true);
                            updateSelectedConnection(connection);

                            const fetchedRemoteFolders = await remote.listRemoteFolders(connection);
                            const updatedFolders = updateSavedRemoteFolders(connection, fetchedRemoteFolders);

                            setIsRemoteOffline(false);
                            setSelectedRemoteFolder(updatedFolders[0]);
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

                            setSelectedRemoteFolder(updatedfolders[0]);
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
                label={<h3>Select remote folder</h3>}
                labelFor='text-input'
                subLabel='Select folder to sync data from'
            >
                <RemoteFolderSelector
                    remoteFolder={selectedRemoteFolder}
                    remoteFolderList={remoteFolderList}
                    loading={isSyncingRemoteFolder || isLoadingFolderList}
                    updatingFolderList={isFetchingFolderStatus}
                    onSelectFolder={(folder) => {
                        setSelectedRemoteFolder(folder);
                    }}
                >
                    <Tooltip content='Sync remote folder'>
                        <AnchorButton
                            icon={IconNames.REFRESH}
                            loading={isSyncingRemoteFolder}
                            disabled={
                                isSyncingRemoteFolder ||
                                isLoadingFolderList ||
                                !selectedRemoteFolder ||
                                remoteFolderList?.length === 0
                            }
                            onClick={async () => {
                                try {
                                    setIsSyncingRemoteFolder(true);
                                    await remote.syncRemoteFolder(
                                        remote.persistentState.selectedConnection,
                                        selectedRemoteFolder,
                                    );

                                    const savedRemoteFolders = remote.persistentState.getSavedRemoteFolders(
                                        remote.persistentState.selectedConnection,
                                    );

                                    savedRemoteFolders.find(
                                        (f) => f.localPath === selectedRemoteFolder?.localPath,
                                    )!.lastSynced = new Date().toISOString();

                                    updateSavedRemoteFolders(
                                        remote.persistentState.selectedConnection,
                                        savedRemoteFolders,
                                    );

                                    setSelectedRemoteFolder(selectedRemoteFolder);
                                } catch {
                                    // eslint-disable-next-line no-alert
                                    alert('Unable to sync remote folder');
                                } finally {
                                    setIsSyncingRemoteFolder(false);
                                }
                            }}
                        />
                    </Tooltip>

                    <Button
                        disabled={isViewReportDisabled}
                        onClick={viewReport}
                        icon={IconNames.EYE_OPEN}
                    >
                        View report
                    </Button>
                </RemoteFolderSelector>
            </FormGroup>
        </>
    );
};

export default RemoteSyncConfigurator;
