import { HttpStatusCode } from 'axios';

export interface Connection {
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

export interface ReportFolder {
    testName: string;
    remotePath: string;
    localPath: string;
    lastModified: number;
    lastSynced?: string;
}

export interface SyncRemoteFolderData {
    status: HttpStatusCode;
    message: string;
}

export interface MountRemoteFolderData {
    status: HttpStatusCode;
    message: string;
}
