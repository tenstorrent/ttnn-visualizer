import { HttpStatusCode } from 'axios';

export interface SyncRemoteFolderData {
    status: HttpStatusCode;
    message: string;
}

export interface MountRemoteFolderData {
    status: HttpStatusCode;
    message: string;
}
