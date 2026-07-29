// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { RemoteFolder } from '../definitions/RemoteConnection';
import { ReportFolder } from '../definitions/Reports';

const RANK_DIRECTORY_PATTERN = /^rank\d+$/i;

/**
 * The local folder name sync writes for a remote report. Mirrors the backend's
 * `folder_segment_from_remote_path`, including the `_rank<N>` qualifier that keeps
 * identically named reports from different ranks apart.
 */
export const getSyncedFolderName = (remotePath: string): string => {
    const segments = remotePath.split('/').filter(Boolean);
    const reportName = segments.at(-1) ?? '';
    const rankDirectory = [...segments].reverse().find((segment) => RANK_DIRECTORY_PATTERN.test(segment));

    return rankDirectory && rankDirectory !== reportName ? `${reportName}_${rankDirectory}` : reportName;
};

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
