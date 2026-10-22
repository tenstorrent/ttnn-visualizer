// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, MenuItem } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import { type ItemPredicate, ItemRenderer, Select } from '@blueprintjs/select';
import { type ReactNode, useState } from 'react';
import 'styles/components/FolderPicker.scss';
import {
    getFolderLinkState,
    matchesLinkedOnlyFilter,
    shouldShowFolderLinkStatus,
} from '../../functions/folderLinkStatus';
import { ReportLinkRunsById } from '../../definitions/ReportLinks';
import { RemoteConnection, RemoteFolder } from '../../model/RemoteConnection';
import { TEST_IDS } from '../../definitions/TestIds';
import { getReportId } from '../../functions/reportLinks';
import { getRankedReportLabel } from '../../functions/reportRank';
import useRemoteConnection from '../../hooks/useRemote';
import HighlightedText from '../HighlightedText';
import FolderLinkStatusIcon from './FolderLinkStatusIcon';
import FolderPickerFilterActions, { NO_LINKED_RESULTS_TEXT } from './FolderPickerFilterActions';
import { ReportKind } from '../../definitions/EventLogEvent';
import { RemoteFolderType } from '../../definitions/Reports';

interface RemoteFolderRendererOptions {
    type: RemoteFolderType;
    selectedFolder?: RemoteFolder;
    connection?: RemoteConnection;
    showReportName?: boolean;
    showLinkStatus?: boolean;
    linkedRuns?: ReportLinkRunsById | null;
    unlinkedRuns?: ReportLinkRunsById | null;
}

const remoteFolderRenderer =
    ({
        type,
        selectedFolder,
        connection,
        showReportName,
        showLinkStatus,
        linkedRuns,
        unlinkedRuns,
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
                            <FolderLinkStatusIcon
                                linkState={getFolderLinkState(
                                    folderId,
                                    folder.runFingerprint,
                                    linkedRuns,
                                    unlinkedRuns,
                                )}
                            />
                        ) : undefined
                    }
                />
            </div>
        );
    };

interface RemoteFolderSelectorProps {
    remoteFolder?: RemoteFolder;
    /**
     * Folders render in the supplied order (newest first from the backend); link-status badges do
     * not reorder them, and the linked-only toggle only hides rows.
     */
    remoteFolderList?: RemoteFolder[];
    loading?: boolean;
    disabled?: boolean;
    fallbackLabel?: string;
    icon?: IconName;
    onSelectFolder: (folder: RemoteFolder) => void;
    type: RemoteFolderType;
    showReportName?: boolean;
    linkedRuns?: ReportLinkRunsById | null;
    unlinkedRuns?: ReportLinkRunsById | null;
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
    linkedRuns,
    unlinkedRuns,
}: RemoteFolderSelectorProps) => {
    const { persistentState } = useRemoteConnection();
    const remoteConnection = persistentState.selectedConnection;
    const showLinkStatus = shouldShowFolderLinkStatus(linkedRuns, unlinkedRuns);
    const [filterQuery, setFilterQuery] = useState('');
    const [isLinkedOnly, setIsLinkedOnly] = useState(false);
    // Without badges there is nothing to filter on, so a toggle left on must not hide rows.
    const isLinkedOnlyActive = showLinkStatus && isLinkedOnly;

    const isDisabled = loading || remoteFolderList?.length === 0 || disabled;

    return (
        <div className='form-container'>
            <Select
                className='remote-select'
                items={remoteFolderList}
                itemRenderer={remoteFolderRenderer({
                    type,
                    selectedFolder: remoteFolder,
                    connection: remoteConnection,
                    showReportName,
                    showLinkStatus,
                    linkedRuns,
                    unlinkedRuns,
                })}
                filterable
                itemPredicate={filterFolders(type, remoteConnection, {
                    isLinkedOnly: isLinkedOnlyActive,
                    linkedRuns,
                    unlinkedRuns,
                })}
                query={filterQuery}
                onQueryChange={setFilterQuery}
                inputProps={{
                    rightElement: (
                        <FolderPickerFilterActions
                            query={filterQuery}
                            onClearQuery={() => setFilterQuery('')}
                            showLinkedOnlyToggle={showLinkStatus}
                            isLinkedOnly={isLinkedOnly}
                            onToggleLinkedOnly={() => setIsLinkedOnly((current) => !current)}
                        />
                    ),
                }}
                noResults={
                    <MenuItem
                        disabled
                        text={isLinkedOnlyActive ? NO_LINKED_RESULTS_TEXT : 'No results'}
                        roleStructure='listoption'
                    />
                }
                disabled={isDisabled}
                onItemSelect={onSelectFolder}
            >
                <Button
                    icon={icon}
                    endIcon={remoteFolderList.length > 0 ? IconNames.CARET_DOWN : undefined}
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
    type: RemoteFolderType,
    selectedConnection?: RemoteConnection,
): string => {
    if (!folder || !selectedConnection) {
        return 'n/a';
    }

    if (folder.rank !== null && folder.rank !== undefined) {
        return getRemoteFolderLabel(folder);
    }

    const paths: Record<RemoteFolderType, string | undefined> = {
        [ReportKind.PROFILER]: selectedConnection.profilerPath,
        [ReportKind.PERFORMANCE]: selectedConnection.performancePath,
    };

    const pathToReplace = paths?.[type] ?? '';

    const formattedPath = folder.remotePath.toLowerCase().replace(pathToReplace.toLowerCase(), '');

    return formattedPath.startsWith('/') ? formattedPath : `/${formattedPath}`;
};

interface LinkedOnlyFilterOptions {
    isLinkedOnly: boolean;
    linkedRuns?: ReportLinkRunsById | null;
    unlinkedRuns?: ReportLinkRunsById | null;
}

// Built afresh on every render on purpose: QueryList refilters when the predicate's identity
// changes, which is how a toggle or a new link verdict reaches the list.
const filterFolders =
    (
        type: RemoteFolderType,
        connection: RemoteConnection | undefined,
        { isLinkedOnly, linkedRuns, unlinkedRuns }: LinkedOnlyFilterOptions,
    ): ItemPredicate<RemoteFolder> =>
    (query, folder) => {
        const normalisedQuery = query.toLowerCase();

        // Match the raw path too, so a query like `rank0` still finds a folder
        // labelled `Rank 0: ...`.
        const matchesQuery = [formatRemoteFolderPath(folder, type, connection), folder.remotePath].some((value) =>
            value.toLowerCase().includes(normalisedQuery),
        );

        return (
            matchesQuery &&
            matchesLinkedOnlyFilter(
                isLinkedOnly,
                getFolderLinkState(getRemoteFolderId(folder), folder.runFingerprint, linkedRuns, unlinkedRuns),
            )
        );
    };

export default RemoteFolderSelector;
