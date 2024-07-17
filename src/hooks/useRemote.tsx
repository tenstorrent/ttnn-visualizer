// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import axios from 'axios';
import useAppConfig from './useAppConfig';
import { MountRemoteFolderData, SyncRemoteFolderData } from '../model/Remote';

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
    lastModified: string;
    lastSynced?: string;
}

const useRemoteConnection = () => {
    const { getAppConfig, setAppConfig, deleteAppConfig } = useAppConfig();

    const testConnection = async (connection: Partial<Connection>) => {
        let connectionStatus: ConnectionStatus[] = [
            {
                status: ConnectionTestStates.FAILED,
                message: 'No connection provided',
            },
            {
                status: ConnectionTestStates.FAILED,
                message: 'No connection provided',
            },
        ];

        if (!connection.host || !connection.port) {
            return connectionStatus;
        }

        const response = await axios.post(`${import.meta.env.VITE_API_ROOT}/remote/test`, connection);

        if (response.status === 200) {
            connectionStatus = [
                {
                    status: ConnectionTestStates.OK,
                    message: 'Connection successful',
                },
                {
                    status: ConnectionTestStates.OK,
                    message: 'Remote folder path exists',
                },
            ];
        }

        if (response.status === 400) {
            connectionStatus = [
                {
                    status: ConnectionTestStates.OK,
                    message: 'Connection successful',
                },
                {
                    status: ConnectionTestStates.FAILED,
                    message: 'Remote folder path does not exist',
                },
            ];
        }

        return connectionStatus;
    };

    const listRemoteFolders = async (connection?: Connection) => {
        if (!connection || !connection.host || !connection.port) {
            throw new Error('No connection provided');
        }

        return axios.post<Connection, ReportFolder[]>(`${import.meta.env.VITE_API_ROOT}/remote/folder`, connection);
    };

    const syncRemoteFolder = async (connection?: Connection, remoteFolder?: ReportFolder) => {
        if (!connection || !connection.host || !connection.port || !connection.path) {
            throw new Error('No connection provided');
        }

        if (!remoteFolder) {
            throw new Error('No remote folder provided');
        }

        return axios.post<SyncRemoteFolderData>(`${import.meta.env.VITE_API_ROOT}/remote/sync`, {
            connection,
            folder: remoteFolder,
        });
    };

    const mountRemoteFolder = async (connection: Connection, remoteFolder: ReportFolder) => {
        return axios.post<MountRemoteFolderData>(`${import.meta.env.VITE_API_ROOT}/remote/use`, {
            connection,
            folder: remoteFolder,
        });
    };

    const persistentState = {
        get savedConnectionList() {
            return JSON.parse(getAppConfig('remoteConnections') ?? '[]') as Connection[];
        },
        set savedConnectionList(connections: Connection[]) {
            setAppConfig('remoteConnections', JSON.stringify(connections));
        },
        get selectedConnection() {
            const savedSelectedConnection = JSON.parse(getAppConfig('selectedConnection') ?? 'null');

            return (savedSelectedConnection ?? this.savedConnectionList[0]) as Connection | undefined;
        },
        set selectedConnection(connection: Connection | undefined) {
            setAppConfig('selectedConnection', JSON.stringify(connection ?? null));
        },
        getSavedRemoteFolders: (connection?: Connection) => {
            return JSON.parse(getAppConfig(`${connection?.name} - remoteFolders`) ?? '[]') as ReportFolder[];
        },
        setSavedRemoteFolders: (connection: Connection | undefined, folders: ReportFolder[]) => {
            setAppConfig(`${connection?.name} - remoteFolders`, JSON.stringify(folders));
        },
        updateSavedRemoteFoldersConnection(oldConnection?: Connection, newConnection?: Connection) {
            const folders = this.getSavedRemoteFolders(oldConnection);

            this.deleteSavedRemoteFolders(oldConnection);
            this.setSavedRemoteFolders(newConnection, folders);
        },
        deleteSavedRemoteFolders: (connection?: Connection) => {
            deleteAppConfig(`${connection?.name} - remoteFolders`);
        },
    };

    return {
        testConnection,
        syncRemoteFolder,
        listRemoteFolders,
        mountRemoteFolder,
        persistentState,
    };
};

export default useRemoteConnection;
