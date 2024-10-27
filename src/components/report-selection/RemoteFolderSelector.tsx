// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, Icon, MenuItem, Spinner, Tooltip } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import { type ItemPredicate, ItemRenderer, Select } from '@blueprintjs/select';
import { FC, type PropsWithChildren } from 'react';
import { RemoteConnection, RemoteFolder } from '../../definitions/RemoteConnection';
import isRemoteFolderOutdated from '../../functions/isRemoteFolderOutdated';
import useRemoteConnection from '../../hooks/useRemote';

const formatter = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
});

const MAX_REPORT_NAME_LENGTH = 50;

const formatRemoteFolderName = (
    folder?: RemoteFolder,
    connection?: RemoteConnection,
    selectedConnection?: RemoteConnection,
) => {
    if (!folder || !selectedConnection) {
        return 'n/a';
    }

    return connection?.name ?? folder.remotePath.replace(selectedConnection.path, '');
};

const getTestName = (folder: RemoteFolder) => {
    return folder.testName.length > MAX_REPORT_NAME_LENGTH
        ? `${folder.testName.slice(0, MAX_REPORT_NAME_LENGTH)}...`
        : folder.testName;
};

const filterFolders =
    (connection?: RemoteConnection, selectedConnection?: RemoteConnection): ItemPredicate<RemoteFolder> =>
    (query, folder) => {
        return formatRemoteFolderName(folder, connection, selectedConnection)
            .toLowerCase()
            .includes(query.toLowerCase());
    };

const remoteFolderRenderer =
    (syncingFolderList: boolean, connection?: RemoteConnection): ItemRenderer<RemoteFolder> =>
    (folder, { handleClick, modifiers }) => {
        const { persistentState } = useRemoteConnection();

        if (!modifiers.matchesPredicate) {
            return null;
        }

        const { lastSynced, lastModified } = folder;
        let statusIcon = (
            <Tooltip
                content={`Fetching folder status, last sync: ${
                    lastSynced ? formatter.format(new Date(lastSynced * 1000)) : 'Never'
                }`}
            >
                <Spinner size={16} />
            </Tooltip>
        );

        if (!syncingFolderList) {
            if (isRemoteFolderOutdated(folder)) {
                statusIcon = (
                    <Tooltip
                        content={`Folder is stale, last sync: ${
                            lastSynced ? formatter.format(new Date(lastSynced * 1000)) : 'Never'
                        }`}
                    >
                        <Icon
                            icon={IconNames.HISTORY}
                            color='goldenrod'
                        />
                    </Tooltip>
                );
            } else {
                statusIcon = (
                    <Tooltip
                        content={`Folder is up to date, last sync: ${
                            lastSynced ? formatter.format(new Date(lastSynced * 1000)) : 'Never'
                        }`}
                    >
                        <Icon
                            icon={IconNames.UPDATED}
                            color='green'
                        />
                    </Tooltip>
                );
            }
        }

        const getLabelElement = () => (
            <>
                <span className='test-name'>{getTestName(folder)}</span>
                {statusIcon}
            </>
        );

        return (
            <MenuItem
                className='remote-folder-item'
                active={modifiers.active}
                disabled={modifiers.disabled}
                key={`${formatRemoteFolderName(folder, connection, persistentState.selectedConnection)}${lastSynced ?? lastModified}`}
                onClick={handleClick}
                text={formatRemoteFolderName(folder, undefined, persistentState.selectedConnection)}
                textClassName='folder-path'
                icon={IconNames.FOLDER_CLOSE}
                labelElement={getLabelElement()}
                labelClassName='remote-folder-status-icon'
            />
        );
    };

interface RemoteFolderSelectorProps {
    remoteFolder?: RemoteFolder;
    remoteFolderList?: RemoteFolder[];
    remoteConnection?: RemoteConnection;
    loading?: boolean;
    updatingFolderList?: boolean;
    fallbackLabel?: string;
    icon?: string;
    onSelectFolder: (folder: RemoteFolder) => void;
}

const RemoteFolderSelector: FC<PropsWithChildren<RemoteFolderSelectorProps>> = ({
    remoteFolder,
    remoteFolderList = [],
    remoteConnection,
    loading = false,
    updatingFolderList = false,
    onSelectFolder,
    children,
    fallbackLabel = '(No selection)',
    icon = IconNames.FOLDER_OPEN,
}) => {
    const { persistentState } = useRemoteConnection();

    return (
        <div className='buttons-container'>
            <Select
                className='remote-folder-select'
                items={remoteFolderList ?? []}
                itemRenderer={remoteFolderRenderer(updatingFolderList, remoteConnection)}
                filterable
                itemPredicate={filterFolders(remoteConnection, persistentState.selectedConnection)}
                noResults={
                    <MenuItem
                        disabled
                        text='No results'
                        roleStructure='listoption'
                    />
                }
                disabled={loading || remoteFolderList?.length === 0}
                onItemSelect={onSelectFolder}
            >
                <Button
                    icon={icon as IconName}
                    rightIcon={remoteFolderList?.length > 0 ? IconNames.CARET_DOWN : undefined}
                    disabled={loading || remoteFolderList?.length === 0}
                    text={
                        remoteFolder
                            ? formatRemoteFolderName(remoteFolder, remoteConnection, persistentState.selectedConnection)
                            : fallbackLabel
                    }
                />
            </Select>

            {children}
        </div>
    );
};

export default RemoteFolderSelector;
