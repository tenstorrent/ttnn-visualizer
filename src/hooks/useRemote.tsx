// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import axios from 'axios';
import { useCallback } from 'react';
import { ConnectionTestStates } from '../definitions/ConnectionStatus';
import { MountRemoteFolder, RemoteConnection, RemoteFolder } from '../definitions/RemoteConnection';
import axiosInstance from '../libs/axiosInstance';
import useAppConfig from './useAppConfig';
import { normaliseReportFolder } from '../functions/validateReportFolder';
import Endpoints from '../definitions/Endpoints';

const FAILED_NO_CONNECTION = {
    status: ConnectionTestStates.FAILED,
    message: 'No connection provided',
};
const FAILED_NO_PATH = {
    status: ConnectionTestStates.FAILED,
    message: 'Please provide at least one folder path.',
};
export const LOCAL_STORAGE_KEY_CONNECTIONS = 'remoteConnections';
export const LOCAL_STORAGE_KEY_SELECTED = 'selectedConnection';

const useRemoteConnection = () => {
    const { getAppConfig, setAppConfig, deleteAppConfig } = useAppConfig();

    const testConnection = async (connection: Partial<RemoteConnection>) => {
        if (!connection.host || !connection.port) {
            return [FAILED_NO_CONNECTION];
        }

        if (!connection.profilerPath && !connection.performancePath) {
            return [FAILED_NO_PATH];
        }

        const { data: connectionTestStates } = await axiosInstance.post(`${Endpoints.REMOTE}/test`, connection);

        return connectionTestStates;
    };

    const listReportFolders = async (connection?: RemoteConnection): Promise<RemoteFolder[]> => {
        if (!connection || !connection.host || !connection.port) {
            throw new Error('No connection provided');
        }

        if (!connection.profilerPath) {
            return [];
        }

        const response = await axiosInstance.post<RemoteFolder[]>(`${Endpoints.REMOTE}/profiler`, connection);

        return response.data.map(normaliseReportFolder) as RemoteFolder[];
    };

    const listPerformanceFolders = async (connection?: RemoteConnection): Promise<RemoteFolder[]> => {
        if (!connection || !connection.host || !connection.port) {
            throw new Error('No connection provided');
        }

        if (!connection.performancePath) {
            return [];
        }

        const response = await axiosInstance.post<RemoteFolder[]>(`${Endpoints.REMOTE}/performance`, connection);

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

        return axiosInstance.post<RemoteFolder>(`${Endpoints.REMOTE}/sync`, {
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
        return axiosInstance.post<MountRemoteFolder>(`${Endpoints.REMOTE}/use`, {
            connection,
            profiler: profilerRemoteFolder,
            performance: performanceRemoteFolder,
        });
    };

    const persistentState = {
        get savedConnectionList(): RemoteConnection[] {
            const connectionList = safeJsonParse(getAppConfig(LOCAL_STORAGE_KEY_CONNECTIONS), []);
            const parsedList = Array.isArray(connectionList) ? connectionList.filter(isValidConnection) : [];

            return parsedList;
        },
        set savedConnectionList(connectionList: RemoteConnection[]) {
            setAppConfig(LOCAL_STORAGE_KEY_CONNECTIONS, safeJsonStringify(connectionList, '[]'));
        },
        get selectedConnection(): RemoteConnection | undefined {
            const savedSelectedConnection = safeJsonParse(
                getAppConfig(LOCAL_STORAGE_KEY_SELECTED),
                null,
            ) as RemoteConnection | null;

            const connectionList = this.savedConnectionList;

            if (!savedSelectedConnection || !isValidConnection(savedSelectedConnection)) {
                return connectionList[0];
            }

            const existingConnection = connectionList.find(
                (connection) => connection.name === savedSelectedConnection.name,
            );

            return existingConnection ?? connectionList[0];
        },
        set selectedConnection(connection: RemoteConnection | undefined) {
            setAppConfig(LOCAL_STORAGE_KEY_SELECTED, safeJsonStringify(connection ?? null));
        },
        getSavedReportFolders: (connection?: RemoteConnection): RemoteFolder[] => {
            const parsedList = safeJsonParse(getAppConfig(`${connection?.name} - reportFolders`), []);

            return Array.isArray(parsedList) ? parsedList : [];
        },
        setSavedReportFolders: (connection: RemoteConnection | undefined, folders: RemoteFolder[]) => {
            setAppConfig(`${connection?.name} - reportFolders`, safeJsonStringify(folders, '[]'));
        },
        deleteSavedReportFolders: (connection?: RemoteConnection) => {
            deleteAppConfig(`${connection?.name} - reportFolders`);
        },
        getSavedPerformanceFolders: (connection?: RemoteConnection): RemoteFolder[] => {
            const parsedList = safeJsonParse(getAppConfig(`${connection?.name} - performanceFolders`), []);

            return Array.isArray(parsedList) ? parsedList : [];
        },
        setSavedPerformanceFolders: (connection: RemoteConnection | undefined, folders: RemoteFolder[]) => {
            setAppConfig(`${connection?.name} - performanceFolders`, safeJsonStringify(folders, '[]'));
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

    const isSourceFileAvailable = useCallback(async (filePath: string): Promise<boolean> => {
        try {
            const { data } = await axiosInstance.post<{ available?: boolean }>(
                `${Endpoints.REMOTE}/read`,
                { filePath, check_path_only: true },
                {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                },
            );

            return data?.available === true;
        } catch {
            return false;
        }
    }, []);

    const readRemoteFile = async (filePath: string) => {
        try {
            const response = await axiosInstance.post<string>(
                `${Endpoints.REMOTE}/read`,
                { filePath },
                {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                },
            );

            const isRemapped = response.headers['x-ttnn-source-remapped'] === 'true';
            const resolvedPath = response.headers['x-ttnn-resolved-source-path'] || null;

            return {
                data: response.data,
                error: null,
                isRemapped,
                resolvedPath: typeof resolvedPath === 'string' ? resolvedPath : null,
            };
        } catch (error: unknown) {
            if (axios.isAxiosError(error)) {
                const errorMessage = error.response?.data?.error || error.message || 'Failed to read remote file';

                return { data: null, error: errorMessage, isRemapped: false, resolvedPath: null };
            }

            return { data: null, error: 'An unexpected error occurred', isRemapped: false, resolvedPath: null };
        }
    };

    return {
        testConnection,
        syncRemoteFolder,
        listReportFolders,
        listPerformanceFolders,
        mountRemoteFolder,
        persistentState,
        readRemoteFile,
        isSourceFileAvailable,
    };
};

// Could make these more generic but they're only used in useRemote right now
const safeJsonParse = <T,>(value: string | null, fallback: T): T => {
    try {
        return value ? JSON.parse(value) : fallback;
    } catch {
        return fallback;
    }
};

const safeJsonStringify = <T,>(value: T, fallback: string = 'null'): string => {
    try {
        return JSON.stringify(value);
    } catch {
        return fallback;
    }
};

const isValidConnection = (connection?: Partial<RemoteConnection>) => {
    if (
        !connection?.name ||
        !connection?.username ||
        !connection?.host ||
        !connection?.port ||
        (!connection?.profilerPath && !connection?.performancePath)
    ) {
        return false;
    }

    return true;
};

export default useRemoteConnection;
