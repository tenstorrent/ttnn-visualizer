// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, Icon, MenuItem, Spinner, Tooltip } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import { type ItemPredicate, ItemRenderer, Select } from '@blueprintjs/select';
import { FC, type PropsWithChildren } from 'react';
import { RemoteConnection, RemoteFolder } from '../../definitions/RemoteConnection';
import isRemoteFolderOutdated from '../../functions/isRemoteFolderOutdated';
import { isEqual } from '../../functions/math';
import useRemoteConnection from '../../hooks/useRemote';

const formatter = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
});

const MAX_REPORT_NAME_LENGTH = 50;
type FolderTypes = 'performance' | 'report';

const formatRemoteFolderName = (folder: RemoteFolder, type: FolderTypes, selectedConnection?: RemoteConnection) => {
    if (!folder || !selectedConnection) {
        return 'n/a';
    }

    const paths = {
        report: selectedConnection.reportPath,
        performance: selectedConnection.performancePath,
    };

    const pathToReplace = paths[type]!;

    return folder.remotePath.toLowerCase().replace(pathToReplace.toLowerCase(), '');
};

const getTestName = (folder: RemoteFolder) => {
    return folder.testName.length > MAX_REPORT_NAME_LENGTH
        ? `${folder.testName.slice(0, MAX_REPORT_NAME_LENGTH)}...`
        : folder.testName;
};

const filterFolders =
    (type: FolderTypes, connection?: RemoteConnection): ItemPredicate<RemoteFolder> =>
    (query, folder) => {
        return formatRemoteFolderName(folder, type, connection).toLowerCase().includes(query.toLowerCase());
    };

const remoteFolderRenderer =
    (
        syncingFolderList: boolean,
        type: FolderTypes,
        selectedFolder?: RemoteFolder,
        connection?: RemoteConnection,
    ): ItemRenderer<RemoteFolder> =>
    (folder, { handleClick, modifiers }) => {
        const { persistentState } = useRemoteConnection();
        const isUsingRemoteQuerying = persistentState.selectedConnection?.useRemoteQuerying;

        if (!modifiers.matchesPredicate) {
            return null;
        }

        const { lastSynced, lastModified } = folder;
        const lastSyncedDate = lastSynced ? formatter.format(new Date(lastSynced)) : 'Never';

        let statusIcon = (
            <Tooltip content={`Fetching folder status, last sync: ${lastSyncedDate}`}>
                <Spinner size={16} />
            </Tooltip>
        );

        if (!syncingFolderList) {
            if (isRemoteFolderOutdated(folder)) {
                statusIcon = (
                    <Tooltip content={`Folder is stale, last sync: ${lastSyncedDate}`}>
                        <Icon
                            icon={IconNames.HISTORY}
                            color='goldenrod'
                        />
                    </Tooltip>
                );
            } else {
                statusIcon = (
                    <Tooltip content={`Folder is up to date, last sync: ${lastSyncedDate}`}>
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
                {!isUsingRemoteQuerying && statusIcon}
            </>
        );

        return (
            <MenuItem
                className='remote-folder-item'
                active={isEqual(selectedFolder, folder)}
                disabled={modifiers.disabled}
                key={`${formatRemoteFolderName(folder, type, connection)}${lastSynced ?? lastModified}`}
                onClick={handleClick}
                text={formatRemoteFolderName(folder, type, connection)}
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
    loading?: boolean;
    updatingFolderList?: boolean;
    fallbackLabel?: string;
    icon?: string;
    onSelectFolder: (folder: RemoteFolder) => void;
    type: FolderTypes;
}

const RemoteFolderSelector: FC<PropsWithChildren<RemoteFolderSelectorProps>> = ({
    remoteFolder,
    remoteFolderList = [],
    loading = false,
    updatingFolderList = false,
    onSelectFolder,
    children,
    fallbackLabel = '(No selection)',
    icon = IconNames.FOLDER_OPEN,
    type,
}) => {
    const { persistentState } = useRemoteConnection();
    const remoteConnection = persistentState.selectedConnection;

    return (
        <div className='buttons-container'>
            <Select
                className='remote-folder-select'
                items={remoteFolderList ?? []}
                itemRenderer={remoteFolderRenderer(updatingFolderList, type, remoteFolder, remoteConnection)}
                filterable
                itemPredicate={filterFolders(type, remoteConnection)}
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
                    endIcon={remoteFolderList?.length > 0 ? IconNames.CARET_DOWN : undefined}
                    disabled={loading || remoteFolderList?.length === 0}
                    text={remoteFolder ? formatRemoteFolderName(remoteFolder, type, remoteConnection) : fallbackLabel}
                />
            </Select>

            {children}
        </div>
    );
};

export default RemoteFolderSelector;
