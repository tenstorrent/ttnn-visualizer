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
}

export const DELETE_REPORT_LABEL = 'Delete report';
