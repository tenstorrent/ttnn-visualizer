// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useMemo, useState } from 'react';
import { Alert, Button, ButtonVariant, Intent, MenuItem, Position, Tooltip } from '@blueprintjs/core';
import { ItemRenderer, Select } from '@blueprintjs/select';
import { IconNames } from '@blueprintjs/icons';
import { useInstance } from '../../hooks/useAPI';
import 'styles/components/FolderPicker.scss';
import {
    getFolderLinkState,
    shouldShowFolderLinkStatus,
    sortByFolderLinkState,
} from '../../functions/folderLinkStatus';
import { ReportFolder } from '../../definitions/Reports';
import getServerConfig from '../../functions/getServerConfig';
import { getReportId } from '../../functions/reportLinks';
import { formatSyncedReportName } from '../../functions/reportRank';
import HighlightedText from '../HighlightedText';
import FolderLinkStatusIcon from './FolderLinkStatusIcon';

interface LocalFolderPickerProps {
    items: ReportFolder[];
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
    /** Canonical ids previously observed to link with the active counterpart. */
    linkedIds?: Set<string> | null;
    /** Canonical ids previously observed to fail linking with the active counterpart. */
    unlinkedIds?: Set<string> | null;
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
    linkedIds,
    unlinkedIds,
}: LocalFolderPickerProps) => {
    const { data: instance } = useInstance();

    const [folderToDelete, setFolderToDelete] = useState<ReportFolder | null>(null);

    const isDisabled = disabled || loading || !items || items.length === 0 || !instance;
    const activePath = value;
    const activeName = value ? (valueLabel ?? value) : null;
    const isServerMode = !!getServerConfig()?.SERVER_MODE;
    // Loading also blocks trash while an open Select popover can still render
    // items after the trigger disables.
    const isDeleteDisabled = isServerMode || loading;
    const showLinkStatus = shouldShowFolderLinkStatus(linkedIds, unlinkedIds);

    // Linked first, unknown next, failed links last — preserve server order within each group.
    const sortedItems = useMemo(
        () =>
            sortByFolderLinkState(
                items ?? [],
                (folder) => getReportId(folder.syncedName, folder.path),
                linkedIds,
                unlinkedIds,
            ),
        [items, linkedIds, unlinkedIds],
    );

    const renderItem: ItemRenderer<ReportFolder> = (folder, { handleClick, handleFocus, modifiers, query }) => {
        if (!modifiers.matchesPredicate) {
            return null;
        }

        const folderId = getReportId(folder.syncedName, folder.path);

        return (
            <div
                className='folder-picker-menu-item'
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
                        showLinkStatus ? (
                            <FolderLinkStatusIcon linkState={getFolderLinkState(folderId, linkedIds, unlinkedIds)} />
                        ) : undefined
                    }
                />

                {handleDelete && !isServerMode && (
                    <>
                        <Button
                            aria-label='Delete report'
                            icon={IconNames.TRASH}
                            onClick={() => setFolderToDelete(folder)}
                            disabled={isDeleteDisabled}
                            variant={ButtonVariant.MINIMAL}
                            intent={Intent.DANGER}
                        />

                        {folderToDelete && (
                            <Alert
                                canEscapeKeyCancel
                                canOutsideClickCancel
                                isOpen={!!folderToDelete}
                                intent={Intent.DANGER}
                                onCancel={() => setFolderToDelete(null)}
                                onClose={() => setFolderToDelete(null)}
                                onConfirm={() => {
                                    if (!loading) {
                                        handleDelete(folderToDelete);
                                    }
                                    setFolderToDelete(null);
                                }}
                                cancelButtonText='Cancel'
                                confirmButtonText='Delete'
                                // @ts-expect-error BackdropClassName is not defined in AlertProps
                                backdropClassName='delete-folder-backdrop'
                            >
                                <p>
                                    Are you sure you want to delete <strong>{folderToDelete.reportName}</strong>? This
                                    action cannot be undone.
                                </p>
                            </Alert>
                        )}
                    </>
                )}
            </div>
        );
    };

    return (
        <Select<ReportFolder>
            className='folder-picker'
            items={sortedItems}
            itemPredicate={(query, item) => !query || item.path.toLowerCase().includes(query.toLowerCase())}
            itemRenderer={renderItem}
            noResults={
                <MenuItem
                    disabled
                    text='No results.'
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
    );
};

export default LocalFolderPicker;
