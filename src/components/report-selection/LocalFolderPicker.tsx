// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useMemo, useState } from 'react';
import { Alert, Button, ButtonVariant, Intent, MenuItem, Position, Tooltip } from '@blueprintjs/core';
import { ItemRenderer, Select } from '@blueprintjs/select';
import { IconNames } from '@blueprintjs/icons';
import { useInstance } from '../../hooks/useAPI';
import 'styles/components/FolderPicker.scss';
import { compareByFolderLinkState, getFolderLinkState } from '../../definitions/FolderLinkStatus';
import { ReportFolder } from '../../definitions/Reports';
import getServerConfig from '../../functions/getServerConfig';
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
    /** True while the backend is activating a selection — disables the control. */
    loading?: boolean;
    disabled?: boolean;
    /** Paths of items previously observed to link with the active counterpart report. */
    linkedPaths?: Set<string>;
    /** Paths of items previously observed to fail linking with the active counterpart report. */
    unlinkedPaths?: Set<string>;
}

const LocalFolderPicker = ({
    items,
    value,
    handleSelect,
    handleDelete,
    defaultLabel = 'Select a report...',
    valueLabel,
    showReportName,
    loading = false,
    disabled = false,
    linkedPaths,
    unlinkedPaths,
}: LocalFolderPickerProps) => {
    const { data: instance } = useInstance();

    const [folderToDelete, setFolderToDelete] = useState<ReportFolder | null>(null);

    const isDisabled = disabled || loading || !items || items.length === 0 || !instance;
    const activePath = value;
    const activeName = value ? (valueLabel ?? value) : null;
    const isDeleteDisabled = getServerConfig()?.SERVER_MODE || loading;
    const showLinkStatus = linkedPaths !== undefined || unlinkedPaths !== undefined;

    // Linked first, unknown next, failed links last — preserve the server-provided
    // order (most-recently-modified) within each group.
    const sortedItems = useMemo(() => {
        if (!items || (!linkedPaths?.size && !unlinkedPaths?.size)) {
            return items ?? [];
        }

        return [...items].sort((a, b) => compareByFolderLinkState(a.path, b.path, linkedPaths, unlinkedPaths));
    }, [items, linkedPaths, unlinkedPaths]);

    const renderItem: ItemRenderer<ReportFolder> = (folder, { handleClick, handleFocus, modifiers, query }) => {
        if (!modifiers.matchesPredicate) {
            return null;
        }

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
                            {showReportName && <span className='folder-picker-sub-label'>{folder.reportName}</span>}
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
                            <FolderLinkStatusIcon
                                linkState={getFolderLinkState(folder.path, linkedPaths, unlinkedPaths)}
                            />
                        ) : undefined
                    }
                />

                {handleDelete && !isDeleteDisabled && (
                    <>
                        <Button
                            aria-label='Delete report'
                            icon={IconNames.TRASH}
                            onClick={() => setFolderToDelete(folder)}
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
                                onConfirm={() => handleDelete(folderToDelete)}
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
                content={loading ? 'Activating report…' : `/${activePath}`}
                disabled={!loading && !activePath}
                position={Position.RIGHT}
                openOnTargetFocus={false}
            >
                <Button
                    className='folder-picker-button'
                    text={activeName || defaultLabel}
                    disabled={isDisabled}
                    loading={loading}
                    alignText='start'
                    icon={loading ? undefined : IconNames.DOCUMENT_OPEN}
                    endIcon={loading ? undefined : IconNames.CARET_DOWN}
                    variant={ButtonVariant.OUTLINED}
                    fill
                />
            </Tooltip>
        </Select>
    );
};

export default LocalFolderPicker;
