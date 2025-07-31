// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import axios from 'axios';
import { ConnectionTestStates } from '../definitions/ConnectionStatus';
import { MountRemoteFolder, RemoteConnection, RemoteFolder } from '../definitions/RemoteConnection';
import axiosInstance from '../libs/axiosInstance';
import useAppConfig from './useAppConfig';

const FAILED_NO_CONNECTION = {
    status: ConnectionTestStates.FAILED,
    message: 'No connection provided',
};
const FAILED_NO_PATH = {
    status: ConnectionTestStates.FAILED,
    message: 'Please provide at least one folder path.',
};

const useRemoteConnection = () => {
    const { getAppConfig, setAppConfig, deleteAppConfig } = useAppConfig();

    // TODO Ensure on form that SSH connection is valid first
    const fetchSqlitePath = async (connection: Partial<RemoteConnection>) => {
        const { data: connectionTestStates } = await axiosInstance.post('/api/remote/sqlite/detect-path', connection);
        return connectionTestStates;
    };

    const testConnection = async (connection: Partial<RemoteConnection>) => {
        if (!connection.host || !connection.port) {
            return [FAILED_NO_CONNECTION];
        }

        if (!connection.profilerPath && !connection.performancePath) {
            return [FAILED_NO_PATH];
        }

        const { data: connectionTestStates } = await axiosInstance.post('/api/remote/test', connection);

        return connectionTestStates;
    };

    const listReportFolders = async (connection?: RemoteConnection): Promise<RemoteFolder[]> => {
        if (!connection || !connection.host || !connection.port) {
            throw new Error('No connection provided');
        }

        if (!connection.profilerPath) {
            return [];
        }

        const response = await axiosInstance.post<RemoteFolder[]>('/api/remote/profiler', connection);

        return response.data;
    };

    const listPerformanceFolders = async (connection?: RemoteConnection): Promise<RemoteFolder[]> => {
        if (!connection || !connection.host || !connection.port) {
            throw new Error('No connection provided');
        }

        if (!connection.performancePath) {
            return [];
        }

        const response = await axiosInstance.post<RemoteFolder[]>('/api/remote/performance', {
            connection,
        });

        return response.data;
    };

    const syncRemoteFolder = async (
        connection?: RemoteConnection,
        profilerRemoteFolder?: RemoteFolder,
        performanceRemoteFolder?: RemoteFolder,
    ) => {
        if (!connection || !connection.host || !connection.port || !connection.profilerPath) {
            throw new Error('No connection provided');
        }

        if (!profilerRemoteFolder && !performanceRemoteFolder) {
            throw new Error('No remote folder provided');
        }

        return axiosInstance.post<RemoteFolder>('/api/remote/sync', {
            connection,
            profiler: profilerRemoteFolder,
            performance: performanceRemoteFolder,
        });
    };

    const mountRemoteFolder = async (
        connection: RemoteConnection,
        profilerRemoteFolder?: RemoteFolder,
        performanceRemoteFolder?: RemoteFolder,
    ) => {
        return axiosInstance.post<MountRemoteFolder>('/api/remote/use', {
            connection,
            profiler: profilerRemoteFolder,
            performance: performanceRemoteFolder,
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
        getSavedReportFolders: (connection?: RemoteConnection) =>
            JSON.parse(getAppConfig(`${connection?.name} - reportFolders`) ?? '[]') as RemoteFolder[],

        setSavedReportFolders: (connection: RemoteConnection | undefined, folders: RemoteFolder[]) => {
            setAppConfig(`${connection?.name} - reportFolders`, JSON.stringify(folders));
        },
        deleteSavedReportFolders: (connection?: RemoteConnection) => {
            deleteAppConfig(`${connection?.name} - reportFolders`);
        },
        getSavedPerformanceFolders: (connection?: RemoteConnection) =>
            JSON.parse(getAppConfig(`${connection?.name} - performanceFolders`) ?? '[]') as RemoteFolder[],
        setSavedPerformanceFolders: (connection: RemoteConnection | undefined, folders: RemoteFolder[]) => {
            setAppConfig(`${connection?.name} - performanceFolders`, JSON.stringify(folders));
        },
        deleteSavedPerformanceFolders: (connection?: RemoteConnection) => {
            deleteAppConfig(`${connection?.name} - performanceFolders`);
        },
        updateSavedRemoteFoldersConnection(oldConnection?: RemoteConnection, newConnection?: RemoteConnection) {
            const reportFolders = this.getSavedReportFolders(oldConnection);
            const performanceFolders = this.getSavedPerformanceFolders(oldConnection);

            this.deleteSavedReportFolders(oldConnection);
            this.deleteSavedPerformanceFolders(oldConnection);
            this.setSavedReportFolders(newConnection, reportFolders);
            this.setSavedPerformanceFolders(newConnection, performanceFolders);
        },
    };

    const readRemoteFile = async (connection?: RemoteConnection) => {
        try {
            const response = await axiosInstance.post('/api/remote/read', connection);

            return response.data;
        } catch (error) {
            return axios.isAxiosError(error) ? error.message : error;
        }
    };

    return {
        testConnection,
        syncRemoteFolder,
        listReportFolders,
        listPerformanceFolders,
        mountRemoteFolder,
        fetchSqlitePath,
        persistentState,
        readRemoteFile,
    };
};

export default useRemoteConnection;
