// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

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

type FolderTypes = 'performance' | 'profiler';

const formatRemoteFolderName = (
    folder: RemoteFolder,
    type: FolderTypes,
    selectedConnection?: RemoteConnection,
): string => {
    if (!folder || !selectedConnection) {
        return 'n/a';
    }

    const paths = {
        profiler: selectedConnection.profilerPath,
        performance: selectedConnection.performancePath,
    };

    const pathToReplace = paths[type]!;

    return folder.remotePath.toLowerCase().replace(pathToReplace.toLowerCase(), '');
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
        if (!modifiers.matchesPredicate) {
            return null;
        }

        const { lastSynced, lastModified, reportName } = folder;
        const lastSyncedDate = lastSynced ? formatter.format(getUTC(lastSynced)) : 'Never';

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
                <span>{reportName}</span>
                <span className='status-icon'>{statusIcon}</span>
            </>
        );

        return (
            <MenuItem
                className='remote-folder-item'
                active={selectedFolder?.reportName === reportName}
                disabled={modifiers.disabled}
                key={`${formatRemoteFolderName(folder, type, connection)}${lastSynced ?? lastModified}`}
                onClick={handleClick}
                text={formatRemoteFolderName(folder, type, connection)}
                icon={selectedFolder?.reportName === reportName ? IconNames.SAVED : IconNames.DOCUMENT}
                labelElement={getLabelElement()}
                labelClassName='remote-folder-status-icon'
            />
        );
    };

interface RemoteFolderSelectorProps {
    remoteFolder?: RemoteFolder;
    remoteFolderList?: RemoteFolder[];
    loading?: boolean;
    disabled?: boolean;
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
    disabled = false,
    updatingFolderList = false,
    onSelectFolder,
    children,
    fallbackLabel = '(No selection)',
    icon = IconNames.DOCUMENT_OPEN,
    type,
}) => {
    const { persistentState } = useRemoteConnection();
    const remoteConnection = persistentState.selectedConnection;

    const isDisabled = loading || remoteFolderList?.length === 0 || disabled;

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
                disabled={isDisabled}
                onItemSelect={onSelectFolder}
            >
                <Button
                    icon={icon as IconName}
                    endIcon={remoteFolderList?.length > 0 ? IconNames.CARET_DOWN : undefined}
                    disabled={isDisabled}
                    text={remoteFolder ? formatRemoteFolderName(remoteFolder, type, remoteConnection) : fallbackLabel}
                />
            </Select>

            {children}
        </div>
    );
};

const getUTC = (epoch: number): Date => {
    const date = new Date(0);
    date.setUTCSeconds(epoch);

    return date;
};

export default RemoteFolderSelector;
