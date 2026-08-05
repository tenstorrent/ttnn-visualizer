// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export enum ReportLocation {
    LOCAL = 'local',
    REMOTE = 'remote',
}

// A report's `world_size` is the number of ranks it spans. Anything above this
// is a multi-host capture, which the API currently scopes to rank 0. #1842
export const SINGLE_HOST_WORLD_SIZE = 1;

export interface ReportFolder {
    path: string;
    reportName: string;
}
