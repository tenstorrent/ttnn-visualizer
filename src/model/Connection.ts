import { HttpStatusCode } from 'axios';

export interface RemoteConnection {
    name: string;
    host: string;
    port: number;
    path: string;
}

export enum ConnectionTestStates {
    IDLE,
    PROGRESS,
    FAILED,
    OK,
}

export interface ConnectionStatus {
    status: ConnectionTestStates;
    message: string;
}

export interface RemoteFolder {
    testName: string;
    remotePath: string;
    localPath: string;
    lastModified: number;
    lastSynced?: string;
}

export interface SyncRemoteFolder {
    status: HttpStatusCode;
    message: string;
}

export interface MountRemoteFolder {
    status: HttpStatusCode;
    message: string;
}
