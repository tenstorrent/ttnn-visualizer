// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { ReportKind } from './EventLogEvent';

export enum ReportLocation {
    LOCAL = 'local',
    REMOTE = 'remote',
}

export type RemoteFolderType = ReportKind.PROFILER | ReportKind.PERFORMANCE;

// A report's `world_size` is the number of ranks it spans. Anything above this
// is a multi-host capture, which the API currently scopes to rank 0. #1842
export const SINGLE_HOST_WORLD_SIZE = 1;

export interface ReportFolder {
    path: string;
    reportName: string;
    // Folder this report occupies on local disk. Carries the report's identity,
    // since `path` is the remote path while a report is freshly selected and the
    // synced folder name after a reload — and `reportName` is display-only.
    syncedName?: string;
}
