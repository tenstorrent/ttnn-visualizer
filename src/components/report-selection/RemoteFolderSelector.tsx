// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, Icon, Intent, MenuItem, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import { type ItemPredicate, ItemRenderer, Select } from '@blueprintjs/select';
import { FC, type PropsWithChildren } from 'react';
import { TEST_IDS } from '../../definitions/TestIds';
import {
    NEVER_SYNCED_LABEL,
    REPORT_OUTDATED_LABEL,
    REPORT_UP_TO_DATE_LABEL,
    RemoteConnection,
    RemoteFolder,
    SYNC_DATE_FORMATTER,
    getUTCFromEpoch,
} from '../../definitions/RemoteConnection';
import isRemoteFolderOutdated from '../../functions/isRemoteFolderOutdated';
import useRemoteConnection from '../../hooks/useRemote';
import HighlightedText from '../HighlightedText';

type FolderTypes = 'performance' | 'profiler';

const remoteFolderRenderer =
    (
        type: FolderTypes,
        selectedFolder?: RemoteFolder,
        connection?: RemoteConnection,
        showReportName?: boolean,
    ): ItemRenderer<RemoteFolder> =>
    (folder, { handleClick, modifiers, query }) => {
        if (!modifiers.matchesPredicate) {
            return null;
        }

        const { lastSynced, lastModified, reportName, remotePath } = folder;
        const isReportOutdated = isRemoteFolderOutdated(folder);

        const statusIcon = (
            <Tooltip
                content={
                    <>
                        {isReportOutdated ? REPORT_OUTDATED_LABEL : REPORT_UP_TO_DATE_LABEL}
                        <br />
                        <strong>
                            {lastSynced ? SYNC_DATE_FORMATTER.format(getUTCFromEpoch(lastSynced)) : NEVER_SYNCED_LABEL}
                        </strong>
                    </>
                }
                placement={PopoverPosition.TOP}
            >
                <Icon
                    icon={isReportOutdated ? IconNames.UPDATED : IconNames.HISTORY}
                    intent={isReportOutdated ? Intent.WARNING : Intent.SUCCESS}
                />
            </Tooltip>
        );

        return (
            <div
                className='folder-picker-menu-item'
                key={`${formatRemoteFolderPath(folder, type, connection)}${lastSynced ?? lastModified}`}
            >
                <MenuItem
                    active={selectedFolder?.remotePath === remotePath}
                    disabled={modifiers.disabled}
                    onClick={handleClick}
                    text={
                        <>
                            <HighlightedText
                                text={formatRemoteFolderPath(folder, type, connection)}
                                filter={query}
                            />
                            {showReportName && <span className='folder-picker-sub-label'>{reportName}</span>}
                        </>
                    }
                    icon={selectedFolder?.remotePath === remotePath ? IconNames.SAVED : IconNames.DOCUMENT}
                    labelElement={<span className='status-icon'>{statusIcon}</span>}
                />
            </div>
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
    showReportName?: boolean;
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
    showReportName,
}) => {
    const { persistentState } = useRemoteConnection();
    const remoteConnection = persistentState.selectedConnection;

    const isDisabled = loading || remoteFolderList?.length === 0 || disabled;

    return (
        <div className='form-container'>
            <Select
                className='remote-select'
                items={remoteFolderList ?? []}
                itemRenderer={remoteFolderRenderer(type, remoteFolder, remoteConnection, showReportName)}
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

const formatRemoteFolderPath = (
    folder: RemoteFolder,
    type: FolderTypes,
    selectedConnection?: RemoteConnection,
): string => {
    if (!folder || !selectedConnection) {
        return 'n/a';
    }

    const paths: Record<FolderTypes, string | undefined> = {
        profiler: selectedConnection.profilerPath,
        performance: selectedConnection.performancePath,
    };

    const pathToReplace = paths?.[type] ?? '';

    const formattedPath = folder.remotePath.toLowerCase().replace(pathToReplace.toLowerCase(), '');

    return formattedPath.startsWith('/') ? formattedPath : `/${formattedPath}`;
};

const filterFolders =
    (type: FolderTypes, connection?: RemoteConnection): ItemPredicate<RemoteFolder> =>
    (query, folder) =>
        formatRemoteFolderPath(folder, type, connection).toLowerCase().includes(query.toLowerCase());

export default RemoteFolderSelector;
