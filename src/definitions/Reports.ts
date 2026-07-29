// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export enum ReportLocation {
    LOCAL = 'local',
    REMOTE = 'remote',
}

export interface ReportFolder {
    path: string;
    reportName: string;
    // Folder this report occupies on local disk. Carries the report's identity,
    // since `path` is the remote path while a report is freshly selected and the
    // synced folder name after a reload — and `reportName` is display-only.
    syncedName?: string;
}
