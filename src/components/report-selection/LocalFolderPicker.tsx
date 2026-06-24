// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useMemo, useState } from 'react';
import { Alert, Button, ButtonVariant, Icon, Intent, MenuItem, Position, Tooltip } from '@blueprintjs/core';
import { ItemRenderer, Select } from '@blueprintjs/select';
import { IconNames } from '@blueprintjs/icons';
import { useInstance } from '../../hooks/useAPI';
import 'styles/components/FolderPicker.scss';
import { ReportFolder } from '../../definitions/Reports';
import getServerConfig from '../../functions/getServerConfig';
import HighlightedText from '../HighlightedText';

interface LocalFolderPickerProps {
    items: ReportFolder[];
    value: string | null;
    handleSelect: (folder: ReportFolder) => void;
    handleDelete?: (folder: ReportFolder) => void;
    defaultLabel?: string;
    valueLabel?: string | null;
    showReportName?: boolean;
    /** Paths of items previously observed to link with the active counterpart report. */
    linkedPaths?: Set<string>;
}

const LocalFolderPicker = ({
    items,
    value,
    handleSelect,
    handleDelete,
    defaultLabel = 'Select a report...',
    valueLabel,
    showReportName,
    linkedPaths,
}: LocalFolderPickerProps) => {
    const { data: instance } = useInstance();

    const [folderToDelete, setFolderToDelete] = useState<ReportFolder | null>(null);

    const isDisabled = !items || items.length === 0;
    const activePath = value;
    const activeName = value ? (valueLabel ?? value) : null;
    const isDeleteDisabled = getServerConfig()?.SERVER_MODE;

    // Surface reports that linked with the active counterpart first, preserving the
    // server-provided order (most-recently-modified) within each group.
    const sortedItems = useMemo(() => {
        if (!items || !linkedPaths?.size) {
            return items ?? [];
        }

        return [...items].sort((a, b) => Number(linkedPaths.has(b.path)) - Number(linkedPaths.has(a.path)));
    }, [items, linkedPaths]);

    const renderItem: ItemRenderer<ReportFolder> = (folder, { handleClick, handleFocus, modifiers, query }) => {
        if (!modifiers.matchesPredicate) {
            return null;
        }

        const isLinked = linkedPaths?.has(folder.path) ?? false;

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
                    disabled={modifiers.disabled}
                    onClick={handleClick}
                    onFocus={handleFocus}
                    icon={folder.path === activePath ? IconNames.SAVED : IconNames.DOCUMENT}
                    labelElement={
                        isLinked ? (
                            <Tooltip
                                content='Previously linked with the active report'
                                position={Position.RIGHT}
                            >
                                <Icon
                                    icon={IconNames.LINK}
                                    intent={Intent.SUCCESS}
                                />
                            </Tooltip>
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
            disabled={!items || !instance}
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
                    disabled={isDisabled || !instance}
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
