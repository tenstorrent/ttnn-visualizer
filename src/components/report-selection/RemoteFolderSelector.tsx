// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, Icon, MenuItem, Spinner, Tooltip } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import { type ItemPredicate, ItemRenderer, Select } from '@blueprintjs/select';
import { FC, type PropsWithChildren } from 'react';
import { useNavigate } from 'react-router';

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

const formatter = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
});

const formatRemoteFolderName = (folder?: RemoteFolder, connection?: RemoteConnection) => {
    if (!folder) {
        return 'n/a';
    }

    if (!connection) {
        return folder.testName;
    }

    return `${connection.name} — ${folder.testName}`;
};

const filterFolders =
    (connection?: RemoteConnection): ItemPredicate<RemoteFolder> =>
    (query, folder) => {
        return formatRemoteFolderName(folder, connection).toLowerCase().includes(query.toLowerCase());
    };

const isLocalFolderOutdated = (folder: RemoteFolder) => {
    if (!folder.lastSynced) {
        return true;
    }

    const lastSynced = new Date(folder.lastSynced);
    const lastModified = new Date(folder.lastModified);

    return lastModified > lastSynced;
};

const remoteFolderRenderer =
    (syncingFolderList: boolean, connection?: RemoteConnection): ItemRenderer<RemoteFolder> =>
    (folder, { handleClick, modifiers }) => {
        if (!modifiers.matchesPredicate) {
            return null;
        }

        const { lastSynced, lastModified } = folder;
        let statusIcon = (
            <Tooltip
                content={`Fetching folder status, last sync: ${
                    lastSynced ? formatter.format(new Date(lastSynced)) : 'Never'
                }`}
            >
                <Spinner size={16} />
            </Tooltip>
        );

        if (!syncingFolderList) {
            if (isLocalFolderOutdated(folder)) {
                statusIcon = (
                    <Tooltip
                        content={`Folder is stale, last sync: ${
                            lastSynced ? formatter.format(new Date(lastSynced)) : 'Never'
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
                            lastSynced ? formatter.format(new Date(lastSynced)) : 'Never'
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

        return (
            <MenuItem
                className='remote-folder-item'
                active={modifiers.active}
                disabled={modifiers.disabled}
                key={`${formatRemoteFolderName(folder, connection)}${lastSynced ?? lastModified}`}
                onClick={handleClick}
                text={formatRemoteFolderName(folder)}
                // // @ts-expect-error - Hack abusing label, it actually works.
                label={statusIcon}
                labelClassName='remote-folder-status-icon'
            />
        );
    };

interface RemoteFolderSelectorProps {
    remoteFolder?: RemoteFolder;
    remoteFolders?: RemoteFolder[];
    remoteConnection?: RemoteConnection;
    loading?: boolean;
    updatingFolderList?: boolean;
    fallbackLabel?: string;
    icon?: string;
    onSelectFolder: (folder: RemoteFolder) => void;
}

const RemoteFolderSelector: FC<PropsWithChildren<RemoteFolderSelectorProps>> = ({
    remoteFolder,
    remoteFolders = [],
    remoteConnection,
    loading = false,
    updatingFolderList = false,
    onSelectFolder,
    children,
    fallbackLabel = '(No selection)',
    icon = IconNames.FOLDER_OPEN,
}) => {
    const navigate = useNavigate();

    return (
        <div className='buttons-container'>
            <Select
                className='remote-folder-select'
                items={remoteFolders ?? []}
                itemRenderer={remoteFolderRenderer(updatingFolderList, remoteConnection)}
                filterable
                itemPredicate={filterFolders(remoteConnection)}
                noResults={
                    <MenuItem
                        disabled
                        text='No results'
                        roleStructure='listoption'
                    />
                }
                disabled={loading || remoteFolders?.length === 0}
                onItemSelect={onSelectFolder}
            >
                <Button
                    icon={icon as IconName}
                    // rightIcon={remoteFolders && remoteFolders?.length > 0 ? IconNames.CARET_DOWN : undefined}
                    disabled={loading || remoteFolders?.length === 0}
                    text={remoteFolder ? formatRemoteFolderName(remoteFolder, remoteConnection) : fallbackLabel}
                />
            </Select>

            {children}
        </div>
    );
};

export default RemoteFolderSelector;
