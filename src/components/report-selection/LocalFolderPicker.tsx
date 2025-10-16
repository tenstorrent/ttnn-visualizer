// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState } from 'react';
import { Alert, Button, ButtonVariant, Intent, MenuItem, Position, Tooltip } from '@blueprintjs/core';
import { ItemRenderer, Select } from '@blueprintjs/select';
import { IconNames } from '@blueprintjs/icons';
import { useAtomValue } from 'jotai';
import { useInstance } from '../../hooks/useAPI';
import 'styles/components/FolderPicker.scss';
import { ReportFolder, ReportLocation } from '../../definitions/Reports';
import getServerConfig from '../../functions/getServerConfig';
import HighlightedText from '../HighlightedText';
import { activeProfilerReportAtom, profilerReportLocationAtom } from '../../store/app';

interface LocalFolderPickerProps {
    items: ReportFolder[];
    value: string | null;
    handleSelect: (folder: ReportFolder) => void;
    handleDelete?: (folder: ReportFolder) => void;
    defaultLabel?: string;
}

const REPORT_NAME_MAX_LENGTH = 18;

const LocalFolderPicker = ({
    items,
    value,
    handleSelect,
    handleDelete,
    defaultLabel = 'Select a report...',
}: LocalFolderPickerProps) => {
    const isRemote = useAtomValue(profilerReportLocationAtom) === ReportLocation.REMOTE;
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);

    const { data: instance } = useInstance();

    const [folderToDelete, setFolderToDelete] = useState<ReportFolder | null>(null);

    const isDisabled = !items || items.length === 0;
    const activePath = value || null;
    const isDeleteDisabled = getServerConfig()?.SERVER_MODE;

    // Map through items and if reportNames are duplicated append (count) to the name
    const itemsWithUniqueReportNames = items?.map((item, idx, arr) => {
        const name = item.reportName;
        const prevCount = arr.slice(0, idx).filter((i) => i.reportName === name).length;

        if (prevCount === 0) {
            return item;
        }

        return {
            ...item,
            reportName: `${name} (${prevCount})`,
        };
    });

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
                    textClassName='folder-picker-label'
                    text={`/${getPrettyPath(folder.path)}`}
                    labelElement={
                        <Tooltip
                            className='folder-picker-name-label'
                            content={folder.reportName}
                            disabled={folder.reportName.length < REPORT_NAME_MAX_LENGTH}
                            position={Position.RIGHT}
                        >
                            <HighlightedText
                                text={folder.reportName}
                                filter={query}
                            />
                        </Tooltip>
                    }
                    labelClassName='folder-picker-name-label'
                    roleStructure='listoption'
                    active={folder.path === activePath}
                    disabled={modifiers.disabled}
                    onClick={handleClick}
                    onFocus={handleFocus}
                    icon={folder.path === activePath ? IconNames.SAVED : IconNames.DOCUMENT}
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
                                className='bp6-dark'
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
            items={itemsWithUniqueReportNames ?? []}
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
            disabled={!items || !instance}
        >
            <Tooltip content={activePath && !isRemote ? `/${activePath}` : ''}>
                <Button
                    className='folder-picker-button'
                    text={activeProfilerReport && !isRemote ? activeProfilerReport.reportName : defaultLabel}
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

const PATH_REGEX = /^\d+_/gm;
const getPrettyPath = (path: string) => (PATH_REGEX.test(path) ? path.replace(PATH_REGEX, '') : path);

export default LocalFolderPicker;
