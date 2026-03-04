// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, ButtonVariant, Intent, PopoverPosition, Tooltip } from '@blueprintjs/core';
import React, { FC } from 'react';
import { IconName, IconNames } from '@blueprintjs/icons';
import {
    NEVER_SYNCED_LABEL,
    REPORT_OUTDATED_LABEL,
    REPORT_UP_TO_DATE_LABEL,
    RemoteFolder,
    SYNC_DATE_FORMATTER,
    getUTCFromEpoch,
} from '../../definitions/RemoteConnection';

interface RemoteSyncButtonProps {
    selectedReportFolder: RemoteFolder | undefined;
    isSyncingReportFolder: boolean;
    isSelectedReportFolderOutdated: boolean;
    isDisabled: boolean;
    handleClick(selectedFolder: RemoteFolder | undefined): Promise<void>;
}

const RemoteSyncButton: FC<RemoteSyncButtonProps> = ({
    selectedReportFolder,
    isSyncingReportFolder,
    isSelectedReportFolderOutdated,
    isDisabled,
    handleClick,
}) => {
    return (
        <Tooltip
            content={getTooltipContent(selectedReportFolder, isSyncingReportFolder, isSelectedReportFolderOutdated)}
            position={PopoverPosition.TOP}
        >
            <Button
                aria-label='Sync report folder'
                icon={
                    selectedReportFolder
                        ? getSyncIcon(selectedReportFolder, isSyncingReportFolder, isSelectedReportFolderOutdated)
                        : undefined
                }
                intent={getSyncIntent(selectedReportFolder, isSyncingReportFolder, isSelectedReportFolderOutdated)}
                variant={ButtonVariant.MINIMAL}
                loading={isSyncingReportFolder}
                disabled={isDisabled}
                onClick={async () => handleClick(selectedReportFolder)}
            />
        </Tooltip>
    );
};

const getTooltipContent = (
    folder: RemoteFolder | undefined,
    isSyncing: boolean,
    isOutdated: boolean,
): string | React.JSX.Element => {
    if (!folder) {
        return '';
    }

    if (isSyncing) {
        return `Syncing report folder...`;
    }

    return (
        <>
            {isOutdated ? REPORT_OUTDATED_LABEL : REPORT_UP_TO_DATE_LABEL}
            <br />
            <strong>
                {folder.lastSynced
                    ? SYNC_DATE_FORMATTER.format(getUTCFromEpoch(folder.lastSynced))
                    : NEVER_SYNCED_LABEL}
            </strong>
        </>
    );
};

const getSyncIcon = (folder: RemoteFolder | undefined, isSyncing: boolean, isOutdated: boolean): IconName => {
    if (typeof folder === 'undefined') {
        return IconNames.HELP;
    }

    if (isSyncing) {
        return IconNames.REFRESH;
    }

    if (isOutdated) {
        return IconNames.OUTDATED;
    }

    return IconNames.UPDATED;
};

const getSyncIntent = (folder: RemoteFolder | undefined, isSyncing: boolean, isOutdated: boolean): Intent => {
    if (isSyncing) {
        return Intent.NONE;
    }

    if (folder && isOutdated) {
        return Intent.WARNING;
    }

    return Intent.SUCCESS;
};

export default RemoteSyncButton;
