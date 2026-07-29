// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { RemoteFolder } from '../definitions/RemoteConnection';
import { ReportFolder } from '../definitions/Reports';
import { getSyncedFolderName } from './reportRank';

/**
 * Whether a listed remote folder is the report currently loaded. The active report
 * identifies itself by remote path when freshly selected but by synced folder name
 * once restored from the instance record, and ranks of one run share a report name,
 * so neither field alone picks out the right row.
 */
export default function isPerformanceFolderActive(folder: RemoteFolder, activeReport: ReportFolder): boolean {
    return (
        folder.remotePath === activeReport.path || getSyncedFolderName(folder.remotePath) === activeReport.reportName
    );
}
