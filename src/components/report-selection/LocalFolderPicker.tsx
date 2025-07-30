// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState } from 'react';
import { Alert, Button, ButtonVariant, Intent, MenuItem, Tooltip } from '@blueprintjs/core';
import { ItemRenderer, Select } from '@blueprintjs/select';
import { IconNames } from '@blueprintjs/icons';
import { useSession } from '../../hooks/useAPI';
import 'styles/components/FolderPicker.scss';
import { ReportFolder } from '../../definitions/Reports';
import getServerConfig from '../../functions/getServerConfig';
import getUTC from '../../functions/getUTC';

interface LocalFolderPickerProps {
    items: ReportFolder[];
    value: string | null;
    handleSelect: (folder: ReportFolder) => void;
    handleDelete?: (folder: ReportFolder) => void;
    defaultLabel?: string;
}

const formatter = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
});

const LocalFolderPicker = ({
    items,
    value,
    handleSelect,
    handleDelete,
    defaultLabel = 'Select a report...',
}: LocalFolderPickerProps) => {
    const { data: session } = useSession();
    const isDisabled = !items || items.length === 0;
    const path = value || '';

    const [folderToDelete, setFolderToDelete] = useState<ReportFolder | null>(null);

    const isDeleteDisabled = getServerConfig()?.SERVER_MODE;

    const renderItem: ItemRenderer<ReportFolder> = (folder, { handleClick, handleFocus, modifiers }) => {
        if (!modifiers.matchesPredicate) {
            return null;
        }

        return (
            <div
                className='folder-picker-menu-item'
                key={folder.path}
            >
                <MenuItem
                    textClassName='folder-picker-label'
                    text={`/${getPrettyPath(folder.path)}`}
                    labelElement={folder.reportName}
                    labelClassName='folder-picker-name-label'
                    roleStructure='listoption'
                    active={folder.path === path}
                    disabled={modifiers.disabled}
                    onClick={handleClick}
                    onFocus={handleFocus}
                    icon={folder.path === path ? IconNames.SAVED : IconNames.DOCUMENT}
                />

                <span>{formatter.format(getUTC(folder.uploadTime))}</span>

                {handleDelete && !isDeleteDisabled && (
                    <>
                        <Button
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
                                className='bp5-dark'
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
            items={items ?? []}
            itemPredicate={(query, item) => !query || item.reportName.toLowerCase().includes(query.toLowerCase())}
            itemRenderer={renderItem}
            noResults={
                <MenuItem
                    disabled
                    text='No results.'
                    roleStructure='listoption'
                />
            }
            onItemSelect={handleSelect}
            disabled={!items || !session}
            fill
        >
            <Tooltip content={path ? `/${getPrettyPath(path)}` : ''}>
                <Button
                    className='folder-picker-button'
                    text={items && path ? getReportName(items, path) : defaultLabel}
                    disabled={isDisabled || !session}
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

const getReportName = (reports: ReportFolder[], path: string | null) => {
    return reports?.find((report) => report.path === path)?.reportName;
};

const PATH_REGEX = /^\d+_/gm;
const getPrettyPath = (path: string) => (PATH_REGEX.test(path) ? path.replace(PATH_REGEX, '') : path);

export default LocalFolderPicker;
