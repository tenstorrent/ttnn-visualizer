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
        const folderId = getReportId(remotePath, reportName);

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
        () =>
            sortByFolderLinkState(
                remoteFolderList ?? [],
                (folder) => getReportId(folder.remotePath, folder.reportName),
                linkedIds,
                unlinkedIds,
            ),
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
                    text={remoteFolder?.reportName ?? fallbackLabel}
                    data-testid={TEST_IDS.REMOTE_FOLDER_SELECTOR_BUTTON}
                />
            </Select>

            {children}
        </div>
    );
};

const RANK_DIRECTORY_PATTERN = /^rank(\d+)$/i;
// Synced copies carry the rank as a name suffix, since the local report folders
// are siblings and cannot nest a rank directory.
const RANK_SUFFIX_PATTERN = /^(.*)_rank(\d+)$/i;

/**
 * Label a multihost report by its rank rather than its raw path, so both
 * `<ttrun>/rank0/reports/2026_07_28_18_04_24` and its synced copy
 * `2026_07_28_18_04_24_rank0` read `Rank 0: 2026_07_28_18_04_24`.
 * Returns null when no rank is present, leaving the plain path formatting.
 */
const formatMultihostPerformanceLabel = (folder: RemoteFolder): string | null => {
    const segments = folder.remotePath.split('/').filter(Boolean);
    const rankDirectory = segments
        .map((segment) => segment.match(RANK_DIRECTORY_PATTERN))
        .find((match): match is RegExpMatchArray => match !== null);

    if (rankDirectory) {
        return `Rank ${Number(rankDirectory[1])}: ${folder.reportName || segments.at(-1)}`;
    }

    const suffixed = (folder.reportName || segments.at(-1) || '').match(RANK_SUFFIX_PATTERN);

    return suffixed ? `Rank ${Number(suffixed[2])}: ${suffixed[1]}` : null;
};

const formatRemoteFolderPath = (
    folder: RemoteFolder,
    type: FolderTypes,
    selectedConnection?: RemoteConnection,
): string => {
    if (!folder || !selectedConnection) {
        return 'n/a';
    }

    if (type === 'performance' && selectedConnection.multihostPerformance) {
        const rankLabel = formatMultihostPerformanceLabel(folder);

        if (rankLabel) {
            return rankLabel;
        }
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
