// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { RemoteFolder } from '../definitions/RemoteConnection';
import { ReportFolder } from '../definitions/Reports';
import createToastNotification from './createToastNotification';

const getErroredReportFolderLabel = (folder: ReportFolder | RemoteFolder): string => {
    if (folder.reportName) {
        return folder.reportName;
    }

    let path: string | undefined;

    if ('path' in folder) {
        path = folder.path;
    } else if ('remotePath' in folder) {
        path = folder.remotePath;
    }

    if (path) {
        const prefix = path.at(0) !== '/' ? '/' : '';

        return `${prefix}${path}`;
    }

    return 'Unknown report';
};

const UNKNOWN_PATH = '/unknown/path';
const UNKNOWN_REPORT = 'Unknown report';

const normaliseReportFolder = (folder: Partial<ReportFolder> | Partial<RemoteFolder>): ReportFolder | RemoteFolder => {
    const reportName = folder.reportName || UNKNOWN_REPORT;

    if ('path' in folder) {
        return {
            ...folder,
            path: folder.path || UNKNOWN_PATH,
            reportName,
        };
    }

    if ('remotePath' in folder) {
        return {
            ...folder,
            remotePath: folder.remotePath || UNKNOWN_PATH,
            reportName,
        } as RemoteFolder;
    }

    return { ...folder, path: UNKNOWN_PATH, reportName };
};

const hasBeenNormalised = (folder: ReportFolder | RemoteFolder): boolean => {
    const hasValidRemotePath = 'remotePath' in folder && folder.remotePath !== UNKNOWN_PATH;
    const hasValidPath = 'path' in folder && folder.path !== UNKNOWN_PATH;

    return (!hasValidRemotePath || !hasValidPath) && folder.reportName === UNKNOWN_REPORT;
};

const createDataIntegrityWarning = (folder: ReportFolder | RemoteFolder) => {
    return createToastNotification(
        'Data integrity warning: Missing path or report name',
        getErroredReportFolderLabel(folder),
        true,
    );
};

export { getErroredReportFolderLabel, normaliseReportFolder, hasBeenNormalised, createDataIntegrityWarning };
