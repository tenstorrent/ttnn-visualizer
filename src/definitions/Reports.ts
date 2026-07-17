// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export enum ReportLocation {
    LOCAL = 'local',
    REMOTE = 'remote',
}

export interface ReportFolder {
    /** Canonical report key: local folder name/path, or full remotePath for remote. */
    path: string;
    reportName: string;
    /** SSH host when remote; `null`/omitted for local. */
    host?: string | null;
}
