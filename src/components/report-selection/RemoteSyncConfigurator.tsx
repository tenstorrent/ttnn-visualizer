// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FC, useState } from 'react';

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

    const [isSyncingRemoteFolder, _setIsSyncingRemoteFolder] = useState(false);
    const [isLoadingFolderList, _setIsLoadingFolderList] = useState(false);

    const updateSelectedConnection = async (connection: RemoteConnection) => {
        remote.persistentState.selectedConnection = connection;
        setRemoteFolders(remote.persistentState.getSavedRemoteFolders(connection));

        // await updateSelectedFolder(remote.persistentState.getSavedRemoteFolders(connection)[0]);
    };

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
                    connection={{ host: 'ttnn', name: 'test', port: 1234, path: '' }}
                    connections={[{ host: 'ttnn', name: 'test', port: 1234, path: '' }]}
                    disabled={isLoadingFolderList || isSyncingRemoteFolder}
                    loading={isLoadingFolderList}
                    offline={false}
                    onRemoveConnection={() => {}}
                    onSelectConnection={() => {}}
                    onSyncRemoteFolders={() => {}}
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
                    // updatingFolderList={isFetchingFolderStatus}
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
