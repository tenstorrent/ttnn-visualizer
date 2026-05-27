// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { FileStatus } from '../model/APIData';

const FILE_STATUS_LABEL: Readonly<Record<FileStatus, string>> = Object.freeze({
    [FileStatus.STARTED]: 'Starting',
    [FileStatus.DOWNLOADING]: 'Downloading',
    [FileStatus.UPLOADING]: 'Uploading',
    [FileStatus.FINISHED]: 'Finished',
    [FileStatus.FAILED]: 'Failed',
    [FileStatus.INACTIVE]: 'Inactive',
});

export function getFileStatusLabel(status: FileStatus): string {
    return FILE_STATUS_LABEL[status];
}

const ACTIVE_TRANSFER_STATUSES: ReadonlySet<FileStatus> = new Set([
    FileStatus.STARTED,
    FileStatus.DOWNLOADING,
    FileStatus.UPLOADING,
]);

export function isActiveTransferStatus(status: FileStatus): boolean {
    return ACTIVE_TRANSFER_STATUSES.has(status);
}
