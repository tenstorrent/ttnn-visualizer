// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, MenuItem } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import { type ItemPredicate, ItemRenderer, Select } from '@blueprintjs/select';
import { type ReactNode, useMemo } from 'react';
import 'styles/components/FolderPicker.scss';
import { compareByFolderLinkState, getFolderLinkState } from '../../definitions/FolderLinkStatus';
import { RemoteConnection, RemoteFolder } from '../../definitions/RemoteConnection';
import { TEST_IDS } from '../../definitions/TestIds';
import { getReportId } from '../../functions/reportLinks';
import useRemoteConnection from '../../hooks/useRemote';
import HighlightedText from '../HighlightedText';
import FolderLinkStatusIcon from './FolderLinkStatusIcon';

type FolderTypes = 'performance' | 'profiler';

interface RemoteFolderRendererOptions {
    type: FolderTypes;
    selectedFolder?: RemoteFolder;
    connection?: RemoteConnection;
    showReportName?: boolean;
    showLinkStatus?: boolean;
    linkedIds?: Set<string>;
    unlinkedIds?: Set<string>;
}

const remoteFolderRenderer =
    ({
        type,
        selectedFolder,
        connection,
        showReportName,
        showLinkStatus,
        linkedIds,
        unlinkedIds,
    }: RemoteFolderRendererOptions): ItemRenderer<RemoteFolder> =>
    (folder, { handleClick, modifiers, query }) => {
        if (!modifiers.matchesPredicate) {
            return null;
        }

        const { lastSynced, lastModified, reportName, remotePath } = folder;
        const folderId = getReportId(reportName, remotePath);

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
                    labelElement={
                        showLinkStatus ? (
                            <FolderLinkStatusIcon linkState={getFolderLinkState(folderId, linkedIds, unlinkedIds)} />
                        ) : undefined
                    }
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
    linkedIds?: Set<string>;
    unlinkedIds?: Set<string>;
    children?: ReactNode;
}

const RemoteFolderSelector = ({
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
    linkedIds,
    unlinkedIds,
}: RemoteFolderSelectorProps) => {
    const { persistentState } = useRemoteConnection();
    const remoteConnection = persistentState.selectedConnection;
    const showLinkStatus = linkedIds !== undefined || unlinkedIds !== undefined;

    const isDisabled = loading || remoteFolderList?.length === 0 || disabled;

    const sortedFolderList = useMemo(() => {
        if (!linkedIds?.size && !unlinkedIds?.size) {
            return remoteFolderList ?? [];
        }

        return [...(remoteFolderList ?? [])].sort((a, b) =>
            compareByFolderLinkState(
                getReportId(a.reportName, a.remotePath),
                getReportId(b.reportName, b.remotePath),
                linkedIds,
                unlinkedIds,
            ),
        );
    }, [remoteFolderList, linkedIds, unlinkedIds]);

    return (
        <div className='form-container'>
            <Select
                className='remote-select'
                items={sortedFolderList}
                itemRenderer={remoteFolderRenderer({
                    type,
                    selectedFolder: remoteFolder,
                    connection: remoteConnection,
                    showReportName,
                    showLinkStatus,
                    linkedIds,
                    unlinkedIds,
                })}
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
                    endIcon={sortedFolderList.length > 0 ? IconNames.CARET_DOWN : undefined}
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
