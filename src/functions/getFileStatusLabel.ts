// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { FileStatus } from '../model/APIData';

const FILE_STATUS_LABEL: Readonly<Record<FileStatus, string>> = Object.freeze({
    [FileStatus.STARTED]: 'Starting',
    [FileStatus.DOWNLOADING]: 'Downloading',
    [FileStatus.UPLOADING]: 'Uploading',
    [FileStatus.COMPRESSING]: 'Compressing',
    [FileStatus.FINISHED]: 'Finished',
    [FileStatus.FAILED]: 'Failed',
    [FileStatus.INACTIVE]: 'Inactive',
});

export function getFileStatusLabel(status: FileStatus): string {
    return FILE_STATUS_LABEL[status] ?? status;
}

export function shouldShowStatus(status: FileStatus): boolean {
    return [
        FileStatus.DOWNLOADING,
        FileStatus.STARTED,
        FileStatus.UPLOADING,
        FileStatus.COMPRESSING,
        FileStatus.FAILED,
    ].includes(status);
}
