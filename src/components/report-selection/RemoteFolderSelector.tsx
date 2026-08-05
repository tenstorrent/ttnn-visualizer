// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, MenuItem } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import { type ItemPredicate, ItemRenderer, Select } from '@blueprintjs/select';
import { type ReactNode, useMemo } from 'react';
import 'styles/components/FolderPicker.scss';
import {
    getFolderLinkState,
    shouldShowFolderLinkStatus,
    sortByFolderLinkState,
} from '../../functions/folderLinkStatus';
import { RemoteConnection, RemoteFolder } from '../../definitions/RemoteConnection';
import { TEST_IDS } from '../../definitions/TestIds';
import { getReportId } from '../../functions/reportLinks';
import { getRankedReportLabel } from '../../functions/reportRank';
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
    linkedIds?: Set<string> | null;
    unlinkedIds?: Set<string> | null;
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
        const folderId = getRemoteFolderId(folder);

        return (
            <div
                className='folder-picker-menu-item'
                key={`${remotePath}${lastSynced ?? lastModified}`}
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
    linkedIds?: Set<string> | null;
    unlinkedIds?: Set<string> | null;
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
    const showLinkStatus = shouldShowFolderLinkStatus(linkedIds, unlinkedIds);

    const isDisabled = loading || remoteFolderList?.length === 0 || disabled;

    const sortedFolderList = useMemo(
        () => sortByFolderLinkState(remoteFolderList ?? [], getRemoteFolderId, linkedIds, unlinkedIds),
        [remoteFolderList, linkedIds, unlinkedIds],
    );

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
                    loading={loading}
                    text={remoteFolder ? getRemoteFolderLabel(remoteFolder) : fallbackLabel}
                    data-testid={TEST_IDS.REMOTE_FOLDER_SELECTOR_BUTTON}
                />
            </Select>

            {children}
        </div>
    );
};

/**
 * A report's identity is the folder it syncs into, which is unique per rank and
 * the same before and after a reload. `remotePath` is the fallback for rows
 * cached before the server started reporting the synced name.
 */
const getRemoteFolderId = (folder: RemoteFolder) => getReportId(folder.syncedName, folder.remotePath);

/**
 * Name a folder by its rank when it has one, so that every rank of one launch is
 * distinguishable: they name their reports from their own start times at second
 * granularity and so routinely share a report name.
 */
const getRemoteFolderLabel = (folder: RemoteFolder): string => getRankedReportLabel(folder.reportName, folder.rank);

const formatRemoteFolderPath = (
    folder: RemoteFolder,
    type: FolderTypes,
    selectedConnection?: RemoteConnection,
): string => {
    if (!folder || !selectedConnection) {
        return 'n/a';
    }

    if (folder.rank !== null && folder.rank !== undefined) {
        return getRemoteFolderLabel(folder);
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
    (query, folder) => {
        const normalisedQuery = query.toLowerCase();

        // Match the raw path too, so a query like `rank0` still finds a folder
        // labelled `Rank 0: ...`.
        return [formatRemoteFolderPath(folder, type, connection), folder.remotePath].some((value) =>
            value.toLowerCase().includes(normalisedQuery),
        );
    };

export default RemoteFolderSelector;
