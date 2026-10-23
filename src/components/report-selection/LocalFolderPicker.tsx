// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState } from 'react';
import { Button, ButtonVariant, MenuItem, Position, Tooltip } from '@blueprintjs/core';
import { ItemPredicate, ItemRenderer, Select } from '@blueprintjs/select';
import { IconNames } from '@blueprintjs/icons';
import { useInstance } from '../../hooks/useAPI';
import useFolderPickerFilter from '../../hooks/useFolderPickerFilter';
import 'styles/components/FolderPicker.scss';
import {
    getFolderLinkState,
    matchesLinkedOnlyFilter,
    shouldShowFolderLinkStatus,
} from '../../functions/folderLinkStatus';
import { NO_LINKED_RESULTS_TEXT } from '../../definitions/FolderLinkStatus';
import { ReportLinkRunsById } from '../../definitions/ReportLinks';
import { ReportFolder } from '../../definitions/Reports';
import getServerConfig from '../../functions/getServerConfig';
import isDirectReportMode from '../../functions/isDirectReportMode';
import { getFolderReportId } from '../../functions/reportLinks';
import { formatSyncedReportName } from '../../functions/reportRank';
import { ManagedEntity } from '../../definitions/ManagedEntity';
import { TEST_IDS } from '../../definitions/TestIds';
import ConfirmDeleteAlert from '../ConfirmDeleteAlert';
import HighlightedText from '../HighlightedText';
import FolderLinkStatusIcon from './FolderLinkStatusIcon';
import SelectRowActions from './SelectRowActions';

interface LocalFolderPickerProps {
    /**
     * `null` while the folder list query is still loading — the component renders disabled.
     * Folders render in the supplied order (newest first from the backend); link-status badges do
     * not reorder them, and the linked-only toggle only hides rows.
     */
    items: ReportFolder[] | null;
    value: string | null;
    handleSelect: (folder: ReportFolder) => void;
    handleDelete?: (folder: ReportFolder) => void;
    defaultLabel?: string;
    valueLabel?: string | null;
    showReportName?: boolean;
    /** When true, the picker cannot open or change selection. */
    disabled?: boolean;
    /** When true, shows a spinner on the trigger button and blocks interaction. */
    loading?: boolean;
    /** Canonical ids previously observed to link with the active counterpart, with their runs. */
    linkedRuns?: ReportLinkRunsById | null;
    /** Canonical ids previously observed to fail linking with the active counterpart, with their runs. */
    unlinkedRuns?: ReportLinkRunsById | null;
}

const LocalFolderPicker = ({
    items,
    value,
    handleSelect,
    handleDelete,
    defaultLabel = 'Select a report...',
    valueLabel,
    showReportName,
    disabled = false,
    loading = false,
    linkedRuns,
    unlinkedRuns,
}: LocalFolderPickerProps) => {
    const { data: instance } = useInstance();

    const [folderToDelete, setFolderToDelete] = useState<ReportFolder | null>(null);

    const isDisabled = disabled || loading || !items || items.length === 0 || !instance;
    const activePath = value;
    const activeName = value ? (valueLabel ?? value) : null;
    const isServerMode = !!getServerConfig()?.SERVER_MODE;
    // Direct-report mode lists reports out of the TT-Metal tree, which the app neither created nor
    // manages — the delete routes refuse it outright, so the control could never act on the row.
    // Gates the trash button and its confirmation together — rendering one without the other leaves
    // either a delete with no confirmation step or an alert nothing can open.
    const canDeleteReports = !!handleDelete && !isServerMode && !isDirectReportMode();
    // Loading disables the Select, so in practice the popover and its rows are already gone by the
    // time this matters; the guard on the alert's onConfirm is what actually stops a delete landing
    // mid-load, since the alert outlives the popover. canDeleteReports covers SERVER_MODE and
    // direct-report mode.
    const isDeleteDisabled = loading;
    const showLinkStatus = shouldShowFolderLinkStatus(linkedRuns, unlinkedRuns);
    const { isLinkedOnlyActive, selectProps: filterSelectProps } = useFolderPickerFilter(showLinkStatus);

    // The badge and the linked-only filter both read this, so they cannot disagree about a row.
    const getLinkState = (folder: ReportFolder) =>
        getFolderLinkState(getFolderReportId(folder), folder.runFingerprint, linkedRuns, unlinkedRuns);

    // Rebuilt every render on purpose: QueryList refilters when the predicate's identity changes,
    // which is how a toggle or a new link verdict reaches the list.
    const itemPredicate: ItemPredicate<ReportFolder> = (query, folder) =>
        (!query || folder.path.toLowerCase().includes(query.toLowerCase())) &&
        matchesLinkedOnlyFilter(isLinkedOnlyActive, getLinkState(folder));

    const renderItem: ItemRenderer<ReportFolder> = (folder, { handleClick, handleFocus, modifiers, query }) => {
        if (!modifiers.matchesPredicate) {
            return null;
        }

        return (
            // MenuItem renders the <li role="option"> itself, so this layout wrapper can't be one
            // without nesting list items. Marking it presentational keeps the option an owned child
            // of the listbox in the accessibility tree instead of hiding it behind a plain div.
            <div
                className='folder-picker-menu-item'
                role='none'
                data-testid={TEST_IDS.FOLDER_PICKER_ROW}
                key={`${folder.path} - ${folder.reportName}`}
            >
                <MenuItem
                    text={
                        <>
                            <HighlightedText
                                text={`/${folder.path}`}
                                filter={query}
                            />
                            {showReportName && (
                                <span className='folder-picker-sub-label'>
                                    {formatSyncedReportName(folder.reportName)}
                                </span>
                            )}
                        </>
                    }
                    roleStructure='listoption'
                    active={folder.path === activePath}
                    disabled={modifiers.disabled || loading}
                    onClick={handleClick}
                    onFocus={handleFocus}
                    icon={folder.path === activePath ? IconNames.SAVED : IconNames.DOCUMENT}
                    labelElement={
                        showLinkStatus ? <FolderLinkStatusIcon linkState={getLinkState(folder)} /> : undefined
                    }
                />

                {canDeleteReports && (
                    <SelectRowActions
                        entity={ManagedEntity.REPORT}
                        itemName={folder.reportName}
                        disabled={isDeleteDisabled}
                        onDelete={() => setFolderToDelete(folder)}
                    />
                )}
            </div>
        );
    };

    return (
        <>
            <Select<ReportFolder>
                className='folder-picker'
                items={items ?? []}
                itemPredicate={itemPredicate}
                itemRenderer={renderItem}
                {...filterSelectProps}
                noResults={
                    <MenuItem
                        disabled
                        text={isLinkedOnlyActive ? NO_LINKED_RESULTS_TEXT : 'No results.'}
                        roleStructure='listoption'
                    />
                }
                onItemSelect={handleSelect}
                disabled={isDisabled}
            >
                <Tooltip
                    content={`/${activePath}`}
                    disabled={!activePath}
                    position={Position.RIGHT}
                    openOnTargetFocus={false}
                >
                    <Button
                        className='folder-picker-button'
                        text={activeName || defaultLabel}
                        disabled={isDisabled}
                        loading={loading}
                        alignText='start'
                        icon={IconNames.DOCUMENT_OPEN}
                        endIcon={IconNames.CARET_DOWN}
                        variant={ButtonVariant.OUTLINED}
                        fill
                    />
                </Tooltip>
            </Select>

            {canDeleteReports && folderToDelete && (
                <ConfirmDeleteAlert
                    isOpen
                    entity={ManagedEntity.REPORT}
                    entityName={folderToDelete.reportName}
                    onCancel={() => setFolderToDelete(null)}
                    onConfirm={() => {
                        if (!loading) {
                            handleDelete(folderToDelete);
                        }
                        setFolderToDelete(null);
                    }}
                />
            )}
        </>
    );
};

export default LocalFolderPicker;
