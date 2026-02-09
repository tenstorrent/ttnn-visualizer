// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { HttpStatusCode } from 'axios';

export interface RemoteConnection {
    name: string;
    username: string;
    host: string;
    port: number;
    profilerPath: string;
    performancePath?: string;
    /** Optional path to SSH private key (e.g. ~/.ssh/id_ed25519). Key must be in authorized_keys on the server. */
    identityFile?: string;
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

export const SYNC_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
});

export const getUTCFromEpoch = (epoch: number): Date => new Date(epoch * 1000);

export const NEVER_SYNCED_LABEL = 'never';
