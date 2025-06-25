// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { HttpStatusCode } from 'axios';

export interface RemoteConnection {
    name: string;
    username: string;
    host: string;
    port: number;
    reportPath?: string; // Deprecated - use profilerPath
    profilerPath: string;
    performancePath?: string;
    sqliteBinaryPath?: string;
    useRemoteQuerying: boolean;
}

export interface RemoteFolder {
    reportName: string;
    remotePath: string;
    lastModified: number;
    lastSynced?: number | null;
}

export interface SyncRemoteFolder {
    status: HttpStatusCode;
    message: string;
}

export interface MountRemoteFolder {
    status: HttpStatusCode;
    message: string;
}
