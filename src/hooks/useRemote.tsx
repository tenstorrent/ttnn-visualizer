// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import axios from 'axios';
import { ConnectionStatus, ConnectionTestStates } from '../definitions/ConnectionStatus';
import {
    MountRemoteFolder,
    RemoteConnection,
    RemoteFolder as RemoteReportFolder,
} from '../definitions/RemoteConnection';
import axiosInstance from '../libs/axiosInstance';
import useAppConfig from './useAppConfig';

const useRemoteConnection = () => {
    const { getAppConfig, setAppConfig, deleteAppConfig } = useAppConfig();

    // TODO Ensure on form that SSH connection is valid first
    const fetchSqlitePath = async (connection: Partial<RemoteConnection>) => {
        const { data: connectionTestStates } = await axiosInstance.post(
            `${import.meta.env.VITE_API_ROOT}/remote/sqlite/detect-path`,
            connection,
        );
        return connectionTestStates;
    };

    const testConnection = async (connection: Partial<RemoteConnection>) => {
        const connectionStatus: ConnectionStatus[] = [
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

        const { data: connectionTestStates } = await axiosInstance.post(
            `${import.meta.env.VITE_API_ROOT}/remote/test`,
            connection,
        );
        return connectionTestStates;
    };

    const listRemoteReports = async (connection?: RemoteConnection) => {
        if (!connection || !connection.host || !connection.port) {
            throw new Error('No connection provided');
        }

        const response = await axiosInstance.post<RemoteReportFolder[]>(
            `${import.meta.env.VITE_API_ROOT}/remote/folder`,
            connection,
        );

        return response.data;
    };

    const syncRemoteReport = async (connection?: RemoteConnection, remoteFolder?: RemoteReportFolder) => {
        if (!connection || !connection.host || !connection.port || !connection.path) {
            throw new Error('No connection provided');
        }

        if (!remoteFolder) {
            throw new Error('No remote folder provided');
        }

        return axiosInstance.post<RemoteReportFolder>(`${import.meta.env.VITE_API_ROOT}/remote/sync`, {
            connection,
            folder: remoteFolder,
        });
    };

    const mountRemoteReport = async (connection: RemoteConnection, remoteFolder: RemoteReportFolder) => {
        return axiosInstance.post<MountRemoteFolder>(`${import.meta.env.VITE_API_ROOT}/remote/use`, {
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
        getSavedRemoteReports: (connection?: RemoteConnection) => {
            return JSON.parse(getAppConfig(`${connection?.name} - remoteReports`) ?? '[]') as RemoteReportFolder[];
        },
        setSavedRemoteReports: (connection: RemoteConnection | undefined, reports: RemoteReportFolder[]) => {
            setAppConfig(`${connection?.name} - remoteReports`, JSON.stringify(reports));
        },
        updateSavedRemoteFoldersConnection(oldConnection?: RemoteConnection, newConnection?: RemoteConnection) {
            const folders = this.getSavedRemoteReports(oldConnection);

            this.deleteSavedRemoteReports(oldConnection);
            this.setSavedRemoteReports(newConnection, folders);
        },
        deleteSavedRemoteReports: (connection?: RemoteConnection) => {
            deleteAppConfig(`${connection?.name} - remoteReports`);
        },
    };

    const readRemoteFile = async (connection?: RemoteConnection) => {
        try {
            const response = await axiosInstance.post(`${import.meta.env.VITE_API_ROOT}/remote/read`, connection);

            return response.data;
        } catch (error) {
            return axios.isAxiosError(error) ? error.message : error;
        }
    };

    return {
        testConnection,
        syncRemoteReport,
        listRemoteReports,
        mountRemoteReport,
        fetchSqlitePath,
        persistentState,
        readRemoteFile,
    };
};

export default useRemoteConnection;
