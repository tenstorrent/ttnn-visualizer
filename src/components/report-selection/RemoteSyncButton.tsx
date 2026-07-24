// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, ButtonVariant, Intent, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { useAtomValue } from 'jotai';
import React from 'react';
import { IconName, IconNames } from '@blueprintjs/icons';
import { FileTransferSource } from '../../definitions/FileTransferSource';
import { fileTransferProgressBySourceAtom } from '../../store/fileTransferRegistry';
import { FileProgress, FileStatus } from '../../model/APIData';
import {
    NEVER_SYNCED_LABEL,
    REPORT_OUTDATED_LABEL,
    REPORT_UP_TO_DATE_LABEL,
    RemoteFolder,
    SYNC_DATE_FORMATTER,
} from '../../definitions/RemoteConnection';
import { TEST_IDS } from '../../definitions/TestIds';
import { getUTCFromEpoch } from '../../functions/formatting';

interface RemoteSyncButtonProps {
    selectedReportFolder: RemoteFolder | undefined;
    isSyncingReportFolder: boolean;
    isSelectedReportFolderOutdated: boolean;
    isDisabled: boolean;
    handleClick(selectedFolder: RemoteFolder | undefined): Promise<void>;
}

const RemoteSyncButton = ({
    selectedReportFolder,
    isSyncingReportFolder,
    isSelectedReportFolderOutdated,
    isDisabled,
    handleClick,
}: RemoteSyncButtonProps) => {
    // Intentionally REMOTE_SYNC-only so the tooltip stays scoped to sync even
    // when FileStatusOverlay is showing an aggregate from another source.
    const fileTransferProgress = useAtomValue(fileTransferProgressBySourceAtom(FileTransferSource.REMOTE_SYNC));

    return (
        <Tooltip
            content={getTooltipContent(
                selectedReportFolder,
                isSyncingReportFolder,
                isSelectedReportFolderOutdated,
                fileTransferProgress,
            )}
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
                disabled={isDisabled || isSyncingReportFolder}
                onClick={async () => handleClick(selectedReportFolder)}
                data-testid={TEST_IDS.REMOTE_SYNC_BUTTON}
            />
        </Tooltip>
    );
};

const getTooltipContent = (
    folder: RemoteFolder | undefined,
    isSyncing: boolean,
    isOutdated: boolean,
    fileTransferProgress: FileProgress,
): string | React.JSX.Element => {
    if (!folder) {
        return '';
    }

    if (isSyncing) {
        const { finishedFiles, numberOfFiles, status } = fileTransferProgress;
        const isRemoteSyncInProgress =
            numberOfFiles > 0 && (status === FileStatus.DOWNLOADING || status === FileStatus.STARTED);

        if (isRemoteSyncInProgress) {
            return `Syncing… ${finishedFiles}/${numberOfFiles}`;
        }

        return 'Syncing report folder...';
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
