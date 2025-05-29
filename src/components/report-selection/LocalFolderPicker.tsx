// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { useState } from 'react';
import { Alert, Button, ButtonVariant, Intent, MenuItem } from '@blueprintjs/core';
import { ItemRenderer, Select } from '@blueprintjs/select';
import { IconNames } from '@blueprintjs/icons';
import { useSession } from '../../hooks/useAPI';
import 'styles/components/FolderPicker.scss';

interface LocalFolderPickerProps {
    items: [];
    value: string | null;
    handleSelect: (folder: string) => void;
    handleDelete?: (folder: string) => void;
    defaultLabel?: string;
}

const LocalFolderPicker = ({
    items,
    value,
    handleSelect,
    handleDelete,
    defaultLabel = 'Select a report...',
}: LocalFolderPickerProps) => {
    const { data: session } = useSession();
    const isDisabled = !items || items.length === 0;

    const [showDeleteAlert, setShowDeleteAlert] = useState<boolean>(false);

    const renderItem: ItemRenderer<string> = (folder, { handleClick, handleFocus, modifiers }) => {
        if (!modifiers.matchesPredicate) {
            return null;
        }

        return (
            <div
                className='folder-picker-menu-item'
                key={folder}
            >
                <MenuItem
                    text={`/${folder}`}
                    roleStructure='listoption'
                    active={folder === value}
                    disabled={modifiers.disabled}
                    key={folder}
                    onClick={handleClick}
                    onFocus={handleFocus}
                    icon={modifiers.active ? IconNames.FOLDER_OPEN : IconNames.FOLDER_CLOSE}
                />

                {handleDelete && (
                    <>
                        <Button
                            icon={IconNames.TRASH}
                            onClick={() => setShowDeleteAlert(true)}
                            variant={ButtonVariant.MINIMAL}
                            intent={Intent.DANGER}
                        />

                        <Alert
                            canEscapeKeyCancel
                            isOpen={showDeleteAlert}
                            intent={Intent.DANGER}
                            onClose={() => setShowDeleteAlert(false)}
                            onConfirm={() => {
                                handleDelete(folder);
                                setShowDeleteAlert(false);
                            }}
                            cancelButtonText='Cancel'
                            confirmButtonText='Delete'
                            className='bp5-dark'
                        >
                            <p>
                                Are you sure you want to delete <strong>{folder}</strong>? This action cannot be undone.
                            </p>
                        </Alert>
                    </>
                )}
            </div>
        );
    };

    return (
        <Select
            className='folder-picker'
            items={items ?? []}
            itemPredicate={(query, item) => !query || item.toLowerCase().includes(query.toLowerCase())}
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
            <Button
                className='folder-picker-button'
                text={value ? `/${value}` : defaultLabel}
                disabled={isDisabled || !session}
                alignText='start'
                icon={IconNames.FOLDER_OPEN}
                endIcon={IconNames.CARET_DOWN}
                variant={ButtonVariant.OUTLINED}
                fill
            />
        </Select>
    );
};

export default LocalFolderPicker;
