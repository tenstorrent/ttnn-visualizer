// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FC, useState } from 'react';

import { AnchorButton, FormGroup, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

import AddRemoteConnection from './AddRemoteConnection';
import RemoteFolderSelector from './RemoteFolderSelector';
import RemoteConnectionSelector from './RemoteConnectionSelector';

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
                <RemoteConnectionSelector
                    connection={{ host: 'ttnn', name: 'test', port: 1234, path: '' }}
                    connections={[{ host: 'ttnn', name: 'test', port: 1234, path: '' }]}
                    disabled={isLoadingFolderList || isSyncingRemoteFolder}
                    loading={isLoadingFolderList}
                    offline={false}
                    onEditConnection={() => {}}
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
                </RemoteFolderSelector>
            </FormGroup>
        </>
    );
};

export default RemoteSyncConfigurator;
