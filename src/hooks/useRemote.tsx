// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import useAppConfig from './useAppConfig';

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
    /** Name of the test results folder */
    testName: string;
    /** Remote absolute path to the test results folder */
    remotePath: string;
    /** Local absolute path to the test results folder */
    localPath: string;
    /** Last time the folder was modified on remote */
    lastModified: string;
    /** Last time the folder was synced */
    lastSynced?: string;
}

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

        // TODO: Replace with real call to API
        const response = await getTestConnection(500);

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

    const listRemoteFolders = async (connection?: RemoteConnection) => {
        if (!connection || !connection.host || !connection.port) {
            throw new Error('No connection provided');
        }

        // TODO: Get real folder list
        const response = await getTestFolders();

        return response;
    };

    // TODO: Possibly delete because it isn't used with Greg's remote query approach
    // const syncRemoteFolder = async (connection?: RemoteConnection, remoteFolder?: RemoteFolder) => {
    //     if (!connection || !connection.host || !connection.port || !connection.path) {
    //         throw new Error('No connection provided');
    //     }

    //     if (!remoteFolder) {
    //         throw new Error('No remote folder provided');
    //     }

    //     // TODO: Get real folder list
    //     const response = await getTestFolders();

    //     return response;
    // };

    const persistentState = {
        get savedConnectionList() {
            return JSON.parse(getAppConfig('remoteConnections') ?? '[]') as RemoteConnection[];
        },
        set savedConnectionList(connections: RemoteConnection[]) {
            setAppConfig('remoteConnections', JSON.stringify(connections));
        },
        get selectedConnection() {
            const savedSelectedConnection = JSON.parse(getAppConfig('selectedConnection') ?? 'null');

            return (savedSelectedConnection ?? this.savedConnectionList[0]) as RemoteConnection | undefined;
        },
        set selectedConnection(connection: RemoteConnection | undefined) {
            setAppConfig('selectedConnection', JSON.stringify(connection ?? null));
        },
        getSavedRemoteFolders: (connection?: RemoteConnection) => {
            return JSON.parse(getAppConfig(`${connection?.name}-remoteFolders`) ?? '[]') as RemoteFolder[];
        },
        setSavedRemoteFolders: (connection: RemoteConnection | undefined, folders: RemoteFolder[]) => {
            setAppConfig(`${connection?.name}-remoteFolders`, JSON.stringify(folders));
        },
        updateSavedRemoteFoldersConnection(oldConnection?: RemoteConnection, newConnection?: RemoteConnection) {
            const folders = this.getSavedRemoteFolders(oldConnection);

            this.deleteSavedRemoteFolders(oldConnection);
            this.setSavedRemoteFolders(newConnection, folders);
        },
        deleteSavedRemoteFolders: (connection?: RemoteConnection) => {
            deleteAppConfig(`${connection?.name}-remoteFolders`);
        },
    };

    return {
        testConnection,
        // syncRemoteFolder,
        listRemoteFolders,
        persistentState,
    };
};

// Delay is a function for development so we can simulate async calls
// eslint-disable-next-line compat/compat, no-promise-executor-return
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const getTestConnection = async (status: number) => {
    await delay(1000);

    // fetch('/api/remote/test')

    return {
        status,
        message: '',
    };
};
const getTestFolders = async () => {
    await delay(1000);

    // fetch('/api/remote/folders')

    return [
        {
            testName: 'resnet',
            remotePath: '/generated/ttnn/reports',
            localPath: '/tmp/local',
            lastModified: new Date().toISOString(),
        },
    ];
};

export default useRemoteConnection;
