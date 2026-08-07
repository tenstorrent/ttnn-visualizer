// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import axios, { HttpStatusCode } from 'axios';
import { useCallback } from 'react';
import { ConnectionTestStates } from '../definitions/ConnectionStatus';
import Endpoints from '../definitions/Endpoints';
import { FileTransferSource } from '../definitions/FileTransferSource';
import { MountRemoteFolder, RemoteConnection, RemoteFolder } from '../definitions/RemoteConnection';
import { REMOTE_SYNC_REQUEST_TIMEOUT_MS } from '../definitions/RemoteSync';
import { StackSourceOrigin } from '../definitions/StackTrace';
import { clearFileTransferProgressForSource } from '../store/fileTransferRegistry';
import { isSameConnection, remoteConnectionKey } from '../functions/remoteConnection';
import { beginRemoteSyncRequest, endRemoteSyncRequest } from '../functions/remoteSyncRequest';
import { normaliseReportFolder } from '../functions/validateReportFolder';
import axiosInstance from '../libs/axiosInstance';
import useAppConfig from './useAppConfig';

interface StackSourceAvailability {
    available: boolean;
    source: StackSourceOrigin | null;
}

interface StackSourceReadResponse {
    content?: string;
    resolved_path?: string | null;
}

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

type RemoteFolderPathKey = 'profilerPath' | 'performancePath';

/**
 * Cached folder lists are keyed by connection identity, not by name: names are not unique, and a
 * name-keyed cache lets deleting or renaming one connection discard or overwrite another's data.
 */
export const savedReportFoldersKey = (connection?: RemoteConnection) =>
    `${remoteConnectionKey(connection)} - reportFolders`;

export const savedPerformanceFoldersKey = (connection?: RemoteConnection) =>
    `${remoteConnectionKey(connection)} - performanceFolders`;

/**
 * The name-only keys these caches used before they moved to connection identity. Kept so an
 * upgrade migrates rather than orphans a user's folder lists — the delete paths only ever target
 * the shape they were given, so an entry left under the old key is never cleaned up.
 */
export const legacySavedReportFoldersKey = (connection?: RemoteConnection) => `${connection?.name} - reportFolders`;

export const legacySavedPerformanceFoldersKey = (connection?: RemoteConnection) =>
    `${connection?.name} - performanceFolders`;

const fetchRemoteFolderList = async (
    endpoint: Endpoints,
    connection: RemoteConnection | undefined,
    options: {
        requirePort?: boolean;
        pathKey: RemoteFolderPathKey;
        normalise?: boolean;
        signal?: AbortSignal;
    },
): Promise<RemoteFolder[]> => {
    const { requirePort = false, pathKey, normalise = false, signal } = options;

    if (!connection || !connection.host || (requirePort && !connection.port)) {
        throw new Error('No connection provided');
    }

    if (!connection[pathKey]) {
        return [];
    }

    const response = await axiosInstance.post<RemoteFolder[]>(endpoint, connection, { signal });

    if (response.status === HttpStatusCode.NoContent) {
        return [];
    }

    const folders = Array.isArray(response.data) ? response.data : [];

    return normalise ? (folders.map(normaliseReportFolder) as RemoteFolder[]) : folders;
};

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

    const listProfilerReports = async (connection?: RemoteConnection, signal?: AbortSignal): Promise<RemoteFolder[]> =>
        fetchRemoteFolderList(Endpoints.REMOTE_PROFILER_REPORTS, connection, {
            requirePort: true,
            pathKey: 'profilerPath',
            normalise: true,
            signal,
        });

    const listPerformanceReports = async (
        connection?: RemoteConnection,
        signal?: AbortSignal,
    ): Promise<RemoteFolder[]> =>
        fetchRemoteFolderList(Endpoints.REMOTE_PERFORMANCE_REPORTS, connection, {
            requirePort: true,
            pathKey: 'performancePath',
            signal,
        });

    const listLocalProfilerReports = async (
        connection?: RemoteConnection,
        signal?: AbortSignal,
    ): Promise<RemoteFolder[]> =>
        fetchRemoteFolderList(Endpoints.REMOTE_LOCAL_PROFILER_REPORTS, connection, {
            pathKey: 'profilerPath',
            normalise: true,
            signal,
        });

    const listLocalPerformanceReports = async (
        connection?: RemoteConnection,
        signal?: AbortSignal,
    ): Promise<RemoteFolder[]> =>
        fetchRemoteFolderList(Endpoints.REMOTE_LOCAL_PERFORMANCE_REPORTS, connection, {
            pathKey: 'performancePath',
            signal,
        });

    const syncRemoteFolder = async (
        connection?: RemoteConnection,
        profilerRemoteFolder?: RemoteFolder,
        performanceRemoteFolder?: RemoteFolder,
    ) => {
        if (!connection || !connection.host || !connection.port) {
            throw new Error('No connection provided');
        }

        if (!profilerRemoteFolder && !performanceRemoteFolder) {
            throw new Error('No remote folder provided');
        }

        // Performance-only connections use empty profilerPath; require a path for the folder being synced.
        if (profilerRemoteFolder && !connection.profilerPath) {
            throw new Error('No profiler path provided');
        }

        if (performanceRemoteFolder && !connection.performancePath) {
            throw new Error('No performance path provided');
        }

        // Bound the hang and guarantee REMOTE_SYNC cleanup for every caller —
        // not only RemoteSyncConfigurator's finally (#1757).
        const abortController = beginRemoteSyncRequest();
        try {
            return await axiosInstance.post<RemoteFolder>(
                `${Endpoints.REMOTE}/sync`,
                {
                    connection,
                    profiler: profilerRemoteFolder,
                    performance: performanceRemoteFolder,
                },
                {
                    timeout: REMOTE_SYNC_REQUEST_TIMEOUT_MS,
                    signal: abortController.signal,
                },
            );
        } finally {
            endRemoteSyncRequest(abortController);
            clearFileTransferProgressForSource(FileTransferSource.REMOTE_SYNC);
        }
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

    /**
     * Reads a folder cache, migrating an entry still stored under the pre-identity key.
     *
     * Two connections that share a name share one legacy entry, so the first read to reach it
     * wins and the second sees no cache. That's the ambiguity the identity key exists to remove,
     * and a re-fetch costs the user less than leaving the entry unreachable.
     */
    const readSavedFolders = (currentKey: string, legacyKey: string): RemoteFolder[] => {
        const stored = getAppConfig(currentKey);

        if (stored === null) {
            const legacy = getAppConfig(legacyKey);

            if (legacy !== null) {
                deleteAppConfig(legacyKey);

                const migrated = safeJsonParse(legacy, []);

                if (Array.isArray(migrated)) {
                    setAppConfig(currentKey, safeJsonStringify(migrated, '[]'));

                    return migrated;
                }

                return [];
            }
        }

        const parsedList = safeJsonParse(stored, []);

        return Array.isArray(parsedList) ? parsedList : [];
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

            // Matching on identity rather than name alone: two connections may share a name, and
            // resolving to the wrong one makes callers mistake which connection is in use.
            const existingConnection = connectionList.find((connection) =>
                isSameConnection(connection, savedSelectedConnection),
            );

            return existingConnection ?? connectionList[0];
        },
        set selectedConnection(connection: RemoteConnection | undefined) {
            setAppConfig(LOCAL_STORAGE_KEY_SELECTED, safeJsonStringify(connection ?? null));
        },
        getSavedReportFolders: (connection?: RemoteConnection): RemoteFolder[] =>
            readSavedFolders(savedReportFoldersKey(connection), legacySavedReportFoldersKey(connection)),
        setSavedReportFolders: (connection: RemoteConnection | undefined, folders: RemoteFolder[]) => {
            setAppConfig(savedReportFoldersKey(connection), safeJsonStringify(folders, '[]'));
        },
        deleteSavedReportFolders: (connection?: RemoteConnection) => {
            deleteAppConfig(savedReportFoldersKey(connection));
            // Also clears a never-read legacy entry, which no later delete would find.
            deleteAppConfig(legacySavedReportFoldersKey(connection));
        },
        getSavedPerformanceFolders: (connection?: RemoteConnection): RemoteFolder[] =>
            readSavedFolders(savedPerformanceFoldersKey(connection), legacySavedPerformanceFoldersKey(connection)),
        setSavedPerformanceFolders: (connection: RemoteConnection | undefined, folders: RemoteFolder[]) => {
            setAppConfig(savedPerformanceFoldersKey(connection), safeJsonStringify(folders, '[]'));
        },
        deleteSavedPerformanceFolders: (connection?: RemoteConnection) => {
            deleteAppConfig(savedPerformanceFoldersKey(connection));
            deleteAppConfig(legacySavedPerformanceFoldersKey(connection));
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

    const setPersistentSelectedConnection = (connection: RemoteConnection | undefined) => {
        setAppConfig(LOCAL_STORAGE_KEY_SELECTED, safeJsonStringify(connection ?? null));
    };

    const setPersistentSavedConnectionList = (connectionList: RemoteConnection[]) => {
        setAppConfig(LOCAL_STORAGE_KEY_CONNECTIONS, safeJsonStringify(connectionList, '[]'));
    };

    const isSourceFileAvailable = useCallback(
        async (
            filePath: string,
            signal?: AbortSignal,
            sourceFileId?: number | null,
        ): Promise<StackSourceAvailability> => {
            try {
                const params: { filePath?: string; sourceFileId?: number } = {};
                if (filePath) {
                    params.filePath = filePath;
                }
                if (sourceFileId != null) {
                    params.sourceFileId = sourceFileId;
                }
                const { data } = await axiosInstance.get<{
                    available?: boolean;
                    source?: StackSourceOrigin | null;
                }>(`${Endpoints.REMOTE}/stack-trace/test`, {
                    signal,
                    params,
                });

                const available = data?.available === true;
                const rawSource = data?.source;
                const knownSource =
                    typeof rawSource === 'string' && (Object.values(StackSourceOrigin) as string[]).includes(rawSource)
                        ? (rawSource as StackSourceOrigin)
                        : null;
                return {
                    available,
                    source: available ? knownSource : null,
                };
            } catch {
                return { available: false, source: null };
            }
        },
        [],
    );

    const readRemoteFile = async (filePath: string, sourceFileId?: number | null) => {
        try {
            const params: { filePath?: string; sourceFileId?: number } = {};
            if (filePath) {
                params.filePath = filePath;
            }
            if (sourceFileId != null) {
                params.sourceFileId = sourceFileId;
            }
            const { data } = await axiosInstance.get<StackSourceReadResponse>(`${Endpoints.REMOTE}/stack-trace/read`, {
                params,
            });

            const content = typeof data?.content === 'string' ? data.content : null;
            const resolvedPath = typeof data?.resolved_path === 'string' ? data.resolved_path : null;

            return {
                data: content,
                error: null,
                resolvedPath,
            };
        } catch (error: unknown) {
            const standardError = {
                data: null,
                resolvedPath: null,
                error: 'An unexpected error occurred',
            };

            if (axios.isAxiosError(error)) {
                return {
                    ...standardError,
                    error: error.response?.data?.error || error.message || 'Failed to read remote file',
                };
            }

            return standardError;
        }
    };

    return {
        testConnection,
        syncRemoteFolder,
        listProfilerReports,
        listPerformanceReports,
        listLocalProfilerReports,
        listLocalPerformanceReports,
        mountRemoteFolder,
        persistentState,
        setPersistentSelectedConnection,
        setPersistentSavedConnectionList,
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

// Deliberately does not check the report paths. A relative path was storable before the
// backend required absolute ones, and filtering such a connection out here would erase it:
// the list is read filtered but written whole, so the next add or edit would drop it from
// storage silently. It stays listed and is flagged for repair instead — see
// getRemoteConnectionPathError and RemoteConnectionSelector.
const isValidConnection = (connection?: Partial<RemoteConnection>) =>
    Boolean(
        connection?.name &&
        connection?.username &&
        connection?.host &&
        connection?.port &&
        (connection?.profilerPath || connection?.performancePath),
    );

export default useRemoteConnection;
