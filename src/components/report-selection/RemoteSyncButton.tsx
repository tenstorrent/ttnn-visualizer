// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, ButtonVariant, Intent, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { FC } from 'react';
import { IconName, IconNames } from '@blueprintjs/icons';
import { NEVER_SYNCED_LABEL, RemoteFolder, SYNC_DATE_FORMATTER } from '../../definitions/RemoteConnection';
import getUTCFromEpoch from '../../functions/getUTCFromEpoch';

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
                aria-label={getTooltipContent(
                    selectedReportFolder,
                    isSyncingReportFolder,
                    isSelectedReportFolderOutdated,
                )}
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

const getTooltipContent = (folder: RemoteFolder | undefined, isSyncing: boolean, isOutdated: boolean): string => {
    if (!folder || isSyncing) {
        return '';
    }

    if (isOutdated) {
        return `Click to sync, folder may be out of date - ${folder.lastSynced ? SYNC_DATE_FORMATTER.format(getUTCFromEpoch(folder.lastSynced)) : `last sync: ${NEVER_SYNCED_LABEL}`}`;
    }

    return `Folder last synced ${folder.lastSynced ? `${SYNC_DATE_FORMATTER.format(getUTCFromEpoch(folder.lastSynced))}` : ''}`;
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
