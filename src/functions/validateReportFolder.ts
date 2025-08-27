// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { RemoteFolder } from '../definitions/RemoteConnection';
import { ReportFolder } from '../definitions/Reports';

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

const validateReportFolder = (folder: ReportFolder | RemoteFolder): boolean => {
    let path: string | undefined;

    if ('path' in folder) {
        path = folder.path;
    } else if ('remotePath' in folder) {
        path = folder.remotePath;
    }

    return !!path && !!folder.reportName;
};

export { getErroredReportFolderLabel, validateReportFolder };
