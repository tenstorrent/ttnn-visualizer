// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, Icon, MenuItem, Spinner, Tooltip } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import { type ItemPredicate, ItemRenderer, Select } from '@blueprintjs/select';
import { FC, type PropsWithChildren } from 'react';
import isLocalFolderOutdated from '../../functions/isLocalFolderOutdated';
import { Connection, ReportFolder } from '../../model/Connection';

const formatter = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
});

const formatReportFolderName = (folder?: ReportFolder, connection?: Connection) => {
    if (!folder) {
        return 'n/a';
    }

    if (!connection) {
        return folder.testName;
    }

    return `${connection.name} — ${folder.testName}`;
};

const filterFolders =
    (connection?: Connection): ItemPredicate<ReportFolder> =>
    (query, folder) => {
        return formatReportFolderName(folder, connection).toLowerCase().includes(query.toLowerCase());
    };

const remoteFolderRenderer =
    (syncingFolderList: boolean, connection?: Connection): ItemRenderer<ReportFolder> =>
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
                key={`${formatReportFolderName(folder, connection)}${lastSynced ?? lastModified}`}
                onClick={handleClick}
                text={formatReportFolderName(folder)}
                // @ts-expect-error - Hack abusing label, it actually works.
                label={statusIcon}
                labelClassName='remote-folder-status-icon'
            />
        );
    };

interface RemoteFolderSelectorProps {
    remoteFolder?: ReportFolder;
    remoteFolderList?: ReportFolder[];
    remoteConnection?: Connection;
    loading?: boolean;
    updatingFolderList?: boolean;
    fallbackLabel?: string;
    icon?: string;
    onSelectFolder: (folder: ReportFolder) => void;
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
    return (
        <div className='buttons-container'>
            <Select
                className='remote-folder-select'
                items={remoteFolderList ?? []}
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
                disabled={loading || remoteFolderList?.length === 0}
                onItemSelect={onSelectFolder}
            >
                <Button
                    icon={icon as IconName}
                    rightIcon={remoteFolderList?.length > 0 ? IconNames.CARET_DOWN : undefined}
                    disabled={loading || remoteFolderList?.length === 0}
                    text={remoteFolder ? formatReportFolderName(remoteFolder, remoteConnection) : fallbackLabel}
                />
            </Select>

            {children}
        </div>
    );
};

export default RemoteFolderSelector;
