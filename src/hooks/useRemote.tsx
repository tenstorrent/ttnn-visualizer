// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import axios from 'axios';
import useAppConfig from './useAppConfig';
import { MountRemoteFolder, RemoteConnection, RemoteFolder, SyncRemoteFolder } from '../definitions/RemoteConnection';
import { ConnectionStatus, ConnectionTestStates } from '../definitions/ConnectionStatus';

const useRemoteConnection = () => {
    const { getAppConfig, setAppConfig, deleteAppConfig } = useAppConfig();

    const testConnection = async (connection: Partial<RemoteConnection>) => {
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

        try {
            await axios.post(`${import.meta.env.VITE_API_ROOT}/remote/test`, connection);
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
        } catch (error: unknown) {
            if (axios.isAxiosError(error)) {
                if (error.response && error.response.status >= 400 && error.response.status < 500) {
                    connectionStatus = [
                        {
                            status: ConnectionTestStates.OK,
                            message: 'Connection successful',
                        },
                        {
                            status: ConnectionTestStates.FAILED,
                            message: error.response?.data || 'Error connecting to remote folder',
                        },
                    ];
                }
                if (error.response && error.response.status >= 500) {

                    connectionStatus = [
                        {
                            status: ConnectionTestStates.FAILED,
                            message: 'Connection failed',
                        },
                        {
                            status: ConnectionTestStates.FAILED,
                            message: error.response?.data || 'Error connecting to remote folder',
                        },
                    ];
                }
            }
        }


        return connectionStatus;
    };

    const listRemoteFolders = async (connection?: RemoteConnection) => {
        if (!connection || !connection.host || !connection.port) {
            throw new Error('No connection provided');
        }

        const response = await axios.post<RemoteFolder[]>(`${import.meta.env.VITE_API_ROOT}/remote/folder`, connection);

        return response.data;
    };

    const syncRemoteFolder = async (connection?: RemoteConnection, remoteFolder?: RemoteFolder) => {
        if (!connection || !connection.host || !connection.port || !connection.path) {
            throw new Error('No connection provided');
        }

        if (!remoteFolder) {
            throw new Error('No remote folder provided');
        }

        return axios.post<SyncRemoteFolder>(`${import.meta.env.VITE_API_ROOT}/remote/sync`, {
            connection,
            folder: remoteFolder,
        });
    };

    const mountRemoteFolder = async (connection: RemoteConnection, remoteFolder: RemoteFolder) => {
        return axios.post<MountRemoteFolder>(`${import.meta.env.VITE_API_ROOT}/remote/use`, {
            connection,
            folder: remoteFolder,
        });
    };

    const persistentState = {
        get savedConnectionList() {
            return JSON.parse(getAppConfig('remoteConnections') ?? '[]') as RemoteConnection[];
        },
        set savedConnectionList(connectionList: RemoteConnection[]) {
            setAppConfig('remoteConnections', JSON.stringify(connectionList));
        },
        get selectedConnection() {
            const savedSelectedConnection = JSON.parse(getAppConfig('selectedConnection') ?? 'null');

            return (savedSelectedConnection ?? this.savedConnectionList[0]) as RemoteConnection | undefined;
        },
        set selectedConnection(connection: RemoteConnection | undefined) {
            setAppConfig('selectedConnection', JSON.stringify(connection ?? null));
        },
        getSavedRemoteFolders: (connection?: RemoteConnection) => {
            return JSON.parse(getAppConfig(`${connection?.name} - remoteFolders`) ?? '[]') as RemoteFolder[];
        },
        setSavedRemoteFolders: (connection: RemoteConnection | undefined, folders: RemoteFolder[]) => {
            setAppConfig(`${connection?.name} - remoteFolders`, JSON.stringify(folders));
        },
        updateSavedRemoteFoldersConnection(oldConnection?: RemoteConnection, newConnection?: RemoteConnection) {
            const folders = this.getSavedRemoteFolders(oldConnection);

            this.deleteSavedRemoteFolders(oldConnection);
            this.setSavedRemoteFolders(newConnection, folders);
        },
        deleteSavedRemoteFolders: (connection?: RemoteConnection) => {
            deleteAppConfig(`${connection?.name} - remoteFolders`);
        },
    };

    const readRemoteFile = async (connection?: RemoteConnection) => {
        try {
            const response = await axios.post(`${import.meta.env.VITE_API_ROOT}/remote/read`, connection);

            return response.data;
        } catch (error) {
            return axios.isAxiosError(error) ? error.message : error;
        }
    };

    return {
        testConnection,
        syncRemoteFolder,
        listRemoteFolders,
        mountRemoteFolder,
        persistentState,
        readRemoteFile,
    };
};

export default useRemoteConnection;
