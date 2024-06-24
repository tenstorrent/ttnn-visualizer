// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FC, useState } from 'react';

import { AnchorButton, FormGroup, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

import GraphSelector from './GraphSelector';
import AddRemoteConnection from './AddRemoteConnection';
import RemoteFolderSelector from './RemoteFolderSelector';

interface RemoteConnection {
    name: string;
    host: string;
    port: number;
    path: string;
}

interface RemoteFolder {
    /** Name of the test results folder */
    testName: string;
    /** Remote absolute path to the test results folder */
    remotePath: string;
    /** Local absolute path to the test results folder */
    localPath: string;
    /** Last time the folder was modified on remote */
    lastModified: string;
    /** Last time the folder was synced */
    lastSynced?: string;
}

const RemoteSyncConfigurator: FC = () => {
    const [isSyncingRemoteFolder, setIsSyncingRemoteFolder] = useState(false);
    const [isLoadingFolderList, setIsLoadingFolderList] = useState(false);

    return (
        <>
            <FormGroup
                label={<h3>Add remote sync server</h3>}
                labelFor='text-input'
                subLabel='Add new server connection details'
            >
                <AddRemoteConnection disabled={isLoadingFolderList || isSyncingRemoteFolder} />
            </FormGroup>

            <FormGroup
                label={<h3>Use remote sync server</h3>}
                labelFor='text-input'
                subLabel='Select remote server that will be used for syncing folders'
            >
                {/* <RemoteConnectionSelector
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
                /> */}
            </FormGroup>

            <FormGroup
                label={<h3>Select remote folder</h3>}
                labelFor='text-input'
                subLabel='Select folder to sync data from'
            >
                <RemoteFolderSelector
                    // remoteFolder={selectedFolder}
                    remoteFolders={[]}
                    loading={isSyncingRemoteFolder || isLoadingFolderList}
                    // updatingFolderList={isFetchingFolderStatus}
                    onSelectFolder={() => {}}
                >
                    <Tooltip content='Sync remote folder'>
                        <AnchorButton
                            icon={IconNames.REFRESH}
                            loading={isSyncingRemoteFolder}
                            onClick={() => {}}
                            disabled
                        />
                    </Tooltip>
                    <GraphSelector onSelectGraph={() => {}} disabled />
                </RemoteFolderSelector>
            </FormGroup>
        </>
    );
};

export default RemoteSyncConfigurator;
