// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { HttpStatusCode } from 'axios';

export interface RemoteConnection {
    name: string;
    username: string;
    host: string;
    port: number;
    path: string;
    sqliteBinaryPath?: string;
    useRemoteQuerying: boolean;
}

export interface RemoteFolder {
    testName: string;
    remotePath: string;
    localPath: string;
    lastModified: number;
    lastSynced?: number;
}

export interface SyncRemoteFolder {
    status: HttpStatusCode;
    message: string;
}

export interface MountRemoteFolder {
    status: HttpStatusCode;
    message: string;
}
