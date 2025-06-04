// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, ButtonVariant, Intent, MenuItem, Tooltip } from '@blueprintjs/core';
import { ItemRenderer, Select } from '@blueprintjs/select';
import { IconNames } from '@blueprintjs/icons';
import { useSession } from '../../hooks/useAPI';
import 'styles/components/FolderPicker.scss';
import { ReportFolder } from '../../definitions/Reports';

interface LocalFolderPickerProps {
    items: ReportFolder[];
    value: string | null;
    handleSelect: (folder: ReportFolder) => void;
    handleDelete?: (folder: ReportFolder) => void;
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
    const path = value || '';

    const renderItem: ItemRenderer<ReportFolder> = (folder, { handleClick, handleFocus, modifiers }) => {
        if (!modifiers.matchesPredicate) {
            return null;
        }

        return (
            <div
                className='folder-picker-menu-item'
                key={folder.reportName}
            >
                <MenuItem
                    textClassName='folder-picker-label'
                    text={`/${folder.path}`}
                    labelElement={folder.reportName}
                    labelClassName='folder-picker-name-label'
                    roleStructure='listoption'
                    active={folder.path === path}
                    disabled={modifiers.disabled}
                    onClick={handleClick}
                    onFocus={handleFocus}
                    icon={folder.path === path ? IconNames.SAVED : IconNames.DOCUMENT}
                />

                {handleDelete && (
                    <Button
                        icon={IconNames.TRASH}
                        onClick={() => handleDelete(folder)}
                        variant={ButtonVariant.MINIMAL}
                        intent={Intent.DANGER}
                    />
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
            <Tooltip content={`/${path}`}>
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

export default LocalFolderPicker;
