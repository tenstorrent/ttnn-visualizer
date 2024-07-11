// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FC, useEffect, useState } from 'react';

import { AnchorButton, FormGroup, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

import useRemote, { RemoteConnection, RemoteFolder } from '../../hooks/useRemote';
import AddRemoteConnection from './AddRemoteConnection';
import RemoteFolderSelector from './RemoteFolderSelector';
import RemoteConnectionSelector from './RemoteConnectionSelector';

const RemoteSyncConfigurator: FC = () => {
    const remote = useRemote();
    const [remoteFolders, setRemoteFolders] = useState<RemoteFolder[]>(
        remote.persistentState.getSavedRemoteFolders(remote.persistentState.selectedConnection),
    );

    const [isSyncingRemoteFolder, setIsSyncingRemoteFolder] = useState(false);
    const [isLoadingFolderList, setIsLoadingFolderList] = useState(false);
    const [isFetchingFolderStatus, setIsFetchingFolderStatus] = useState(false);
    const [isRemoteOffline, setIsRemoteOffline] = useState(false);
    const [selectedRemoteFolder, setSelectedRemoteFolder] = useState<RemoteFolder | undefined>(remoteFolders[0]);

    const updateSelectedFolder = (folder?: RemoteFolder) => {
        setSelectedRemoteFolder(folder);
    };

    const updateSelectedConnection = (connection: RemoteConnection) => {
        remote.persistentState.selectedConnection = connection;
        setRemoteFolders(remote.persistentState.getSavedRemoteFolders(connection));

        updateSelectedFolder(remote.persistentState.getSavedRemoteFolders(connection)[0]);
    };

    const updateSavedRemoteFolders = (connection: RemoteConnection | undefined, updatedFolders: RemoteFolder[]) => {
        if (!connection) {
            return [];
        }

        const savedFolders = remote.persistentState.getSavedRemoteFolders(connection);
        const mergedFolders = (updatedFolders ?? []).map((updatedFolder) => {
            const existingFolder = savedFolders?.find((f) => f.localPath === updatedFolder.localPath);

            return {
                ...existingFolder,
                ...updatedFolder,
            } as RemoteFolder;
        });

        remote.persistentState.setSavedRemoteFolders(connection, mergedFolders);
        setRemoteFolders(mergedFolders);

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
                    connections={remote.persistentState.savedConnectionList}
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
                        updateSelectedFolder(undefined);
                    }}
                    onSelectConnection={async (connection) => {
                        try {
                            setIsFetchingFolderStatus(true);
                            updateSelectedConnection(connection);

                            const fetchedRemoteFolders = await remote.listRemoteFolders(connection);
                            const updatedFolders = updateSavedRemoteFolders(connection, fetchedRemoteFolders);

                            setIsRemoteOffline(false);
                            updateSelectedFolder(updatedFolders[0]);
                        } catch {
                            setIsRemoteOffline(true);
                        } finally {
                            setIsFetchingFolderStatus(false);
                        }
                    }}
                    onSyncRemoteFolders={async () => {
                        try {
                            setIsLoadingFolderList(true);

                            const savedRemotefolders = await remote.listRemoteFolders(
                                remote.persistentState.selectedConnection,
                            );

                            const updatedfolders = updateSavedRemoteFolders(
                                remote.persistentState.selectedConnection,
                                savedRemotefolders,
                            );

                            updateSelectedFolder(updatedfolders[0]);
                        } catch {
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
                    remoteFolders={remoteFolders}
                    loading={isSyncingRemoteFolder || isLoadingFolderList}
                    updatingFolderList={isFetchingFolderStatus}
                    onSelectFolder={(folder) => {
                        updateSelectedFolder(folder);

                        // TODO: Need this?
                        // if (remote.persistentState.selectedConnection) {
                        //     document.title = `${remote.persistentState.selectedConnection.name} — ${folder.testName}`;
                        // }
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
                                remoteFolders?.length === 0
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

                                    updateSelectedFolder(selectedRemoteFolder);
                                } catch {
                                    // eslint-disable-next-line no-alert
                                    alert('Unable to sync remote folder');
                                } finally {
                                    setIsSyncingRemoteFolder(false);
                                }
                            }}
                        />
                    </Tooltip>
                </RemoteFolderSelector>
            </FormGroup>
        </>
    );
};

export default RemoteSyncConfigurator;
