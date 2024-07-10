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
    // const selectedFolder = useSelector(getSelectedRemoteFolder) ?? remoteFolders[0];
    // const selectedFolderLocationType = useSelector(getSelectedFolderLocationType);

    const [isSyncingRemoteFolder, setIsSyncingRemoteFolder] = useState(false);
    const [isLoadingFolderList, setIsLoadingFolderList] = useState(false);
    const [isFetchingFolderStatus, setIsFetchingFolderStatus] = useState(false);
    const [isRemoteOffline, setIsRemoteOffline] = useState(false);

    const updateSelectedFolder = async (folder?: RemoteFolder) => {
        // dispatch(setSelectedRemoteFolder(folder));
        // dispatch(setSelectedFolderLocationType('remote'));
        // dispatch(setSelectedRemoteFolder(folder));
    };

    const updateSelectedConnection = async (connection: RemoteConnection) => {
        remote.persistentState.selectedConnection = connection;
        setRemoteFolders(remote.persistentState.getSavedRemoteFolders(connection));

        await updateSelectedFolder(remote.persistentState.getSavedRemoteFolders(connection)[0]);
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
                        remote.persistentState.deleteSavedRemoteFolders(connection);

                        await updateSelectedConnection(updatedConnections[0]);
                        await updateSelectedFolder(undefined);
                    }}
                    onSelectConnection={async (connection) => {
                        try {
                            setIsFetchingFolderStatus(true);
                            await updateSelectedConnection(connection);

                            const fetchedRemoteFolders = await remote.listRemoteFolders(connection);
                            const updatedFolders = updateSavedRemoteFolders(connection, fetchedRemoteFolders);

                            setIsRemoteOffline(false);
                            await updateSelectedFolder(updatedFolders[0]);
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

                            await updateSelectedFolder(updatedfolders[0]);
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
                    // remoteFolder={selectedFolder}
                    remoteFolders={remoteFolders}
                    loading={isSyncingRemoteFolder || isLoadingFolderList}
                    updatingFolderList={isFetchingFolderStatus}
                    onSelectFolder={() => {}}
                    // onSelectFolder={async (folder) => {
                    //     await updateSelectedFolder(folder);

                    //     if (remote.persistentState.selectedConnection) {
                    //         sendEventToMain(
                    //             ElectronEvents.UPDATE_WINDOW_TITLE,
                    //             `${remote.persistentState.selectedConnection.name} — ${folder.testName}`,
                    //         );
                    //     }
                    // }}
                >
                    <Tooltip content='Sync remote folder'>
                        <AnchorButton
                            icon={IconNames.REFRESH}
                            loading={isSyncingRemoteFolder}
                            onClick={() => {}}
                            disabled
                        />
                    </Tooltip>
                </RemoteFolderSelector>
            </FormGroup>
        </>
    );
};

export default RemoteSyncConfigurator;
