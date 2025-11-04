// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, Icon, MenuItem, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import { type ItemPredicate, ItemRenderer, Select } from '@blueprintjs/select';
import { FC, type PropsWithChildren } from 'react';
import { TEST_IDS } from '../../definitions/TestIds';
import {
    NEVER_SYNCED_LABEL,
    RemoteConnection,
    RemoteFolder,
    SYNC_DATE_FORMATTER,
    getUTCFromEpoch,
} from '../../definitions/RemoteConnection';
import isRemoteFolderOutdated from '../../functions/isRemoteFolderOutdated';
import useRemoteConnection from '../../hooks/useRemote';
import 'styles/components/RemoteFolderSelector.scss';
import HighlightedText from '../HighlightedText';

type FolderTypes = 'performance' | 'profiler';

const remoteFolderRenderer =
    (type: FolderTypes, selectedFolder?: RemoteFolder, connection?: RemoteConnection): ItemRenderer<RemoteFolder> =>
    (folder, { handleClick, modifiers, query }) => {
        if (!modifiers.matchesPredicate) {
            return null;
        }

        const { lastSynced, lastModified, reportName, remotePath } = folder;
        const lastSyncedDate = lastSynced
            ? SYNC_DATE_FORMATTER.format(getUTCFromEpoch(lastSynced))
            : NEVER_SYNCED_LABEL;

        const isReportOutdated = isRemoteFolderOutdated(folder);

        const statusIcon = (
            <Tooltip
                content={
                    isReportOutdated
                        ? `Report is stale - last synced: ${lastSyncedDate}`
                        : `Report is up to date - last synced: ${lastSyncedDate}`
                }
                placement={PopoverPosition.TOP}
            >
                <Icon
                    icon={isReportOutdated ? IconNames.UPDATED : IconNames.HISTORY}
                    color={isReportOutdated ? 'goldenrod' : 'green'}
                />
            </Tooltip>
        );

        const getLabelElement = (filterText: string) => (
            <>
                <HighlightedText
                    text={reportName}
                    filter={filterText}
                />
                <span className='status-icon'>{statusIcon}</span>
            </>
        );

        return (
            <MenuItem
                className='remote-folder-item'
                active={selectedFolder?.remotePath === remotePath}
                disabled={modifiers.disabled}
                key={`${formatRemoteFolderName(folder, type, connection)}${lastSynced ?? lastModified}`}
                onClick={handleClick}
                text={formatRemoteFolderName(folder, type, connection)}
                icon={selectedFolder?.remotePath === remotePath ? IconNames.SAVED : IconNames.DOCUMENT}
                labelElement={getLabelElement(query)}
                labelClassName='remote-folder-status-icon'
            />
        );
    };

interface RemoteFolderSelectorProps {
    remoteFolder?: RemoteFolder;
    remoteFolderList?: RemoteFolder[];
    loading?: boolean;
    disabled?: boolean;
    fallbackLabel?: string;
    icon?: IconName;
    onSelectFolder: (folder: RemoteFolder) => void;
    type: FolderTypes;
}

const RemoteFolderSelector: FC<PropsWithChildren<RemoteFolderSelectorProps>> = ({
    remoteFolder,
    remoteFolderList = [],
    loading = false,
    disabled = false,
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
        <div className='form-container'>
            <Select
                className='remote-select'
                items={remoteFolderList ?? []}
                itemRenderer={remoteFolderRenderer(type, remoteFolder, remoteConnection)}
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
                    icon={icon}
                    endIcon={remoteFolderList?.length > 0 ? IconNames.CARET_DOWN : undefined}
                    disabled={isDisabled}
                    text={remoteFolder?.reportName ?? fallbackLabel}
                    data-testid={TEST_IDS.REMOTE_FOLDER_SELECTOR_BUTTON}
                />
            </Select>

            {children}
        </div>
    );
};

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

export default RemoteFolderSelector;
