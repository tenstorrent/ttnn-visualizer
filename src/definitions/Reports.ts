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
    // Set by the server's report listings: true for a bundled demo report under SERVER_MODE.
    isDemo?: boolean;
    // Set by the server's report listings: which run the folder holds now, null when
    // unreadable. Not to be read off an active report, which a remote pick or a reload
    // sets without it; useActiveReportFingerprints asks the instance instead.
    runFingerprint?: string | null;
}

/** The reports beside the active performance report, which is where `?name=` reads them. */
export interface PerfComparisonCandidates {
    // Where the reports sit. Folder names repeat across directories, so this is what
    // tells a pick made against one listing from a namesake in another.
    directory: string;
    // Null when the directory cannot be listed. `?name=` may still read from it, so this
    // says nothing about whether a pick is there; `directory` still says where it would be read.
    reports: ReportFolder[] | null;
}
