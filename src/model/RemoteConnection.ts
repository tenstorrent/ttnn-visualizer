// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { HttpStatusCode } from 'axios';

export interface RemoteConnection {
    name: string;
    username: string;
    host: string;
    port: number;
    profilerPath: string;
    performancePath?: string;
    identityFile?: string; // Optional path to SSH private key.
    // Performance reports sit in per-rank subdirectories of performancePath.
    multihostPerformance?: boolean;
}

export interface RemoteFolder {
    reportName: string;
    remotePath: string;
    lastModified: number;
    lastSynced?: number | null;
    // Name this report occupies on local disk once synced, and its rank. Both are
    // decided by the server, which is the side that writes the folder.
    syncedName?: string;
    rank?: number | null;
    // Which run the local synced copy holds, null until synced. Always sent, so a
    // fresh listing replaces a cached value in mergeRemoteFolders.
    runFingerprint?: string | null;
}

export interface SyncRemoteFolder {
    status: HttpStatusCode;
    message: string;
}

export interface MountRemoteFolder {
    status: HttpStatusCode;
    message: string;
}
