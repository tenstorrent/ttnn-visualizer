// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { renderHook } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTransferSource } from '../src/definitions/FileTransferSource';
import Endpoints from '../src/definitions/Endpoints';
import { REMOTE_SYNC_REQUEST_TIMEOUT_MS } from '../src/definitions/RemoteSync';
import { StackSourceOrigin } from '../src/definitions/StackTrace';
import {
    clearAllFileTransferProgress,
    fileTransferRegistryAtom,
    getInactiveFileTransferProgress,
    setFileTransferProgressForSource,
} from '../src/store/fileTransferRegistry';
import { abortActiveRemoteSyncRequest } from '../src/functions/remoteSyncRequest';
import useRemoteConnection, {
    LOCAL_STORAGE_KEY_CONNECTIONS,
    LOCAL_STORAGE_KEY_SELECTED,
    legacySavedPerformanceFoldersKey,
    legacySavedReportFoldersKey,
    savedPerformanceFoldersKey,
    savedReportFoldersKey,
} from '../src/hooks/useRemote';
import { FileStatus } from '../src/model/APIData';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
    },
}));

beforeEach(() => {
    vi.resetAllMocks();
    window.localStorage.clear();
    clearAllFileTransferProgress();
});

afterEach(() => {
    window.localStorage.clear();
    clearAllFileTransferProgress();
});

describe('useRemoteConnection - stack source GETs', () => {
    it('isSourceFileAvailable issues GET /api/remote/stack-trace/test with filePath query and forwards signal', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockGet = vi.mocked(axiosInstance.default.get);
        mockGet.mockResolvedValue({
            data: { available: true, source: StackSourceOrigin.Path },
        } as AxiosResponse);

        const { result } = renderHook(() => useRemoteConnection());
        const controller = new AbortController();
        const availability = await result.current.isSourceFileAvailable('/some/file.py', controller.signal);

        expect(availability).toEqual({ available: true, source: StackSourceOrigin.Path });
        expect(mockGet).toHaveBeenCalledTimes(1);
        const [url, config] = mockGet.mock.calls[0];
        expect(url).toBe('/api/remote/stack-trace/test');
        expect(config).toMatchObject({
            params: { filePath: '/some/file.py' },
            signal: controller.signal,
        });
    });

    it('isSourceFileAvailable returns unavailable when the request rejects', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockGet = vi.mocked(axiosInstance.default.get);
        mockGet.mockRejectedValue(new Error('boom'));

        const { result } = renderHook(() => useRemoteConnection());
        const availability = await result.current.isSourceFileAvailable('/x');

        expect(availability).toEqual({ available: false, source: null });
    });

    it('isSourceFileAvailable returns unavailable when the response shape is unexpected', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockGet = vi.mocked(axiosInstance.default.get);
        mockGet.mockResolvedValue({ data: { available: 'maybe' } } as AxiosResponse);

        const { result } = renderHook(() => useRemoteConnection());
        const availability = await result.current.isSourceFileAvailable('/x');

        expect(availability).toEqual({ available: false, source: null });
    });

    it('isSourceFileAvailable forwards sourceFileId and parses database origin', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockGet = vi.mocked(axiosInstance.default.get);
        mockGet.mockResolvedValue({
            data: { available: true, source: StackSourceOrigin.Database },
        } as AxiosResponse);

        const { result } = renderHook(() => useRemoteConnection());
        const availability = await result.current.isSourceFileAvailable('', undefined, 42);

        expect(availability).toEqual({ available: true, source: StackSourceOrigin.Database });
        expect(mockGet).toHaveBeenCalledWith('/api/remote/stack-trace/test', {
            params: { sourceFileId: 42 },
        });
    });

    it('isSourceFileAvailable forwards both filePath and sourceFileId', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockGet = vi.mocked(axiosInstance.default.get);
        mockGet.mockResolvedValue({
            data: { available: true, source: StackSourceOrigin.Database },
        } as AxiosResponse);

        const { result } = renderHook(() => useRemoteConnection());
        await result.current.isSourceFileAvailable('/proj/model.py', undefined, 1);

        expect(mockGet).toHaveBeenCalledWith('/api/remote/stack-trace/test', {
            params: { filePath: '/proj/model.py', sourceFileId: 1 },
        });
    });

    it('isSourceFileAvailable drops unknown source values when available', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockGet = vi.mocked(axiosInstance.default.get);
        mockGet.mockResolvedValue({
            data: { available: true, source: 'not-a-real-origin' },
        } as AxiosResponse);

        const { result } = renderHook(() => useRemoteConnection());
        const availability = await result.current.isSourceFileAvailable('/x');

        expect(availability).toEqual({ available: true, source: null });
    });

    it('readRemoteFile issues GET /api/remote/stack-trace/read and parses JSON body', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockGet = vi.mocked(axiosInstance.default.get);
        mockGet.mockResolvedValue({
            data: {
                content: 'file contents',
                resolved_path: '/abs/resolved.py',
            },
        } as AxiosResponse);

        const { result } = renderHook(() => useRemoteConnection());
        const out = await result.current.readRemoteFile('/some/file.py');

        expect(mockGet).toHaveBeenCalledWith('/api/remote/stack-trace/read', {
            params: { filePath: '/some/file.py' },
        });
        expect(out).toEqual({
            data: 'file contents',
            error: null,
            resolvedPath: '/abs/resolved.py',
        });
    });

    it('readRemoteFile forwards sourceFileId without filePath', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockGet = vi.mocked(axiosInstance.default.get);
        mockGet.mockResolvedValue({
            data: { content: 'from db', resolved_path: '/proj/model.py' },
        } as AxiosResponse);

        const { result } = renderHook(() => useRemoteConnection());
        const out = await result.current.readRemoteFile('', 1);

        expect(mockGet).toHaveBeenCalledWith('/api/remote/stack-trace/read', {
            params: { sourceFileId: 1 },
        });
        expect(out).toEqual({
            data: 'from db',
            error: null,
            resolvedPath: '/proj/model.py',
        });
    });

    it('readRemoteFile reports null resolvedPath when JSON field is absent', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockGet = vi.mocked(axiosInstance.default.get);
        mockGet.mockResolvedValue({
            data: { content: 'plain' },
        } as AxiosResponse);

        const { result } = renderHook(() => useRemoteConnection());
        const out = await result.current.readRemoteFile('/x');

        expect(out.data).toBe('plain');
        expect(out.resolvedPath).toBeNull();
        expect(out.error).toBeNull();
    });

    it('readRemoteFile returns the standard error shape when the GET fails', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockGet = vi.mocked(axiosInstance.default.get);
        mockGet.mockRejectedValue(new Error('boom'));

        const { result } = renderHook(() => useRemoteConnection());
        const out = await result.current.readRemoteFile('/x');

        expect(out.data).toBeNull();
        expect(out.resolvedPath).toBeNull();
        expect(typeof out.error).toBe('string');
    });
});

describe('useRemoteConnection - syncRemoteFolder timeout', () => {
    const connection = {
        name: 'c',
        host: 'h',
        port: 22,
        username: 'u',
        profilerPath: '/p',
    };
    const profilerFolder = { remotePath: '/r', reportName: 'r', lastModified: 1 };

    it('posts /api/remote/sync with REMOTE_SYNC_REQUEST_TIMEOUT_MS and an abort signal', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockPost = vi.mocked(axiosInstance.default.post);
        mockPost.mockResolvedValue({ data: { remotePath: '/r', reportName: 'r' } } as AxiosResponse);

        const { result } = renderHook(() => useRemoteConnection());

        await result.current.syncRemoteFolder(connection, profilerFolder);

        expect(mockPost).toHaveBeenCalledWith(
            '/api/remote/sync',
            {
                connection,
                profiler: profilerFolder,
                performance: undefined,
            },
            {
                timeout: REMOTE_SYNC_REQUEST_TIMEOUT_MS,
                signal: expect.any(AbortSignal),
            },
        );
    });

    it('syncs a performance-only connection without requiring profilerPath', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockPost = vi.mocked(axiosInstance.default.post);
        mockPost.mockResolvedValue({ data: { remotePath: '/perf', reportName: 'perf' } } as AxiosResponse);

        const performanceOnlyConnection = {
            name: 'c',
            host: 'h',
            port: 22,
            username: 'u',
            profilerPath: '',
            performancePath: '/perf',
        };
        const performanceFolder = { remotePath: '/perf/r', reportName: 'r', lastModified: 1 };

        const { result } = renderHook(() => useRemoteConnection());
        await result.current.syncRemoteFolder(performanceOnlyConnection, undefined, performanceFolder);

        expect(mockPost).toHaveBeenCalledWith(
            '/api/remote/sync',
            {
                connection: performanceOnlyConnection,
                profiler: undefined,
                performance: performanceFolder,
            },
            expect.objectContaining({
                timeout: REMOTE_SYNC_REQUEST_TIMEOUT_MS,
            }),
        );
    });

    it('throws when syncing a profiler folder without profilerPath', async () => {
        const { result } = renderHook(() => useRemoteConnection());

        await expect(
            result.current.syncRemoteFolder(
                {
                    name: 'c',
                    host: 'h',
                    port: 22,
                    username: 'u',
                    profilerPath: '',
                    performancePath: '/perf',
                },
                profilerFolder,
            ),
        ).rejects.toThrow('No profiler path provided');
    });

    it('throws when syncing a performance folder without performancePath', async () => {
        const { result } = renderHook(() => useRemoteConnection());

        await expect(result.current.syncRemoteFolder(connection, undefined, profilerFolder)).rejects.toThrow(
            'No performance path provided',
        );
    });

    it('clears the REMOTE_SYNC slot when sync rejects', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockPost = vi.mocked(axiosInstance.default.post);
        mockPost.mockRejectedValue(new Error('timeout of 1800000ms exceeded'));

        setFileTransferProgressForSource(FileTransferSource.REMOTE_SYNC, {
            ...getInactiveFileTransferProgress(),
            currentFileName: 'db.sqlite',
            numberOfFiles: 3,
            finishedFiles: 1,
            percentOfCurrent: 0,
            status: FileStatus.DOWNLOADING,
        });

        const { result } = renderHook(() => useRemoteConnection());

        await expect(result.current.syncRemoteFolder(connection, profilerFolder)).rejects.toThrow(
            'timeout of 1800000ms exceeded',
        );

        expect(getDefaultStore().get(fileTransferRegistryAtom)[FileTransferSource.REMOTE_SYNC]).toBeUndefined();
    });

    it('clears the REMOTE_SYNC slot when sync resolves', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockPost = vi.mocked(axiosInstance.default.post);
        mockPost.mockResolvedValue({ data: { remotePath: '/r', reportName: 'r' } } as AxiosResponse);

        setFileTransferProgressForSource(FileTransferSource.REMOTE_SYNC, {
            ...getInactiveFileTransferProgress(),
            status: FileStatus.DOWNLOADING,
            numberOfFiles: 1,
        });

        const { result } = renderHook(() => useRemoteConnection());
        await result.current.syncRemoteFolder(connection, profilerFolder);

        expect(getDefaultStore().get(fileTransferRegistryAtom)[FileTransferSource.REMOTE_SYNC]).toBeUndefined();
    });

    it('rejects and clears REMOTE_SYNC when the active abort signal fires', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockPost = vi.mocked(axiosInstance.default.post);
        mockPost.mockImplementation(
            (_url, _body, config) =>
                new Promise((_resolve, reject) => {
                    const { signal } = config as { signal: AbortSignal };
                    signal.addEventListener('abort', () => {
                        reject(new Error('aborted'));
                    });
                }) as ReturnType<typeof mockPost>,
        );

        setFileTransferProgressForSource(FileTransferSource.REMOTE_SYNC, {
            ...getInactiveFileTransferProgress(),
            status: FileStatus.DOWNLOADING,
            numberOfFiles: 1,
        });

        const { result } = renderHook(() => useRemoteConnection());
        const syncPromise = result.current.syncRemoteFolder(connection, profilerFolder);

        abortActiveRemoteSyncRequest();

        await expect(syncPromise).rejects.toThrow('aborted');
        expect(getDefaultStore().get(fileTransferRegistryAtom)[FileTransferSource.REMOTE_SYNC]).toBeUndefined();
    });
});

describe('useRemoteConnection - listLocal reports', () => {
    const connection = {
        name: 'c',
        host: 'h',
        port: 22,
        username: 'u',
        profilerPath: '/p',
        performancePath: '/perf',
    };

    it('listLocalProfilerReports posts the local profiler endpoint and normalises folders', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockPost = vi.mocked(axiosInstance.default.post);
        mockPost.mockResolvedValue({
            status: 200,
            data: [{ remotePath: '/p/r', reportName: 'r', lastModified: 1, lastSynced: null }],
        } as AxiosResponse);

        const { result } = renderHook(() => useRemoteConnection());
        const folders = await result.current.listLocalProfilerReports(connection);

        expect(mockPost).toHaveBeenCalledWith(Endpoints.REMOTE_LOCAL_PROFILER_REPORTS, connection, {
            signal: undefined,
        });
        expect(folders).toHaveLength(1);
        expect(folders[0].reportName).toBe('r');
    });

    it('listLocalPerformanceReports posts the local performance endpoint', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockPost = vi.mocked(axiosInstance.default.post);
        mockPost.mockResolvedValue({
            status: 200,
            data: [{ remotePath: '/perf/r', reportName: 'r', lastModified: 1, lastSynced: null }],
        } as AxiosResponse);

        const { result } = renderHook(() => useRemoteConnection());
        const folders = await result.current.listLocalPerformanceReports(connection);

        expect(mockPost).toHaveBeenCalledWith(Endpoints.REMOTE_LOCAL_PERFORMANCE_REPORTS, connection, {
            signal: undefined,
        });
        expect(folders).toEqual([{ remotePath: '/perf/r', reportName: 'r', lastModified: 1, lastSynced: null }]);
    });

    it('listLocalProfilerReports returns [] on 204 without treating the body as folders', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockPost = vi.mocked(axiosInstance.default.post);
        mockPost.mockResolvedValue({ status: 204, data: '' } as AxiosResponse);

        const { result } = renderHook(() => useRemoteConnection());
        await expect(result.current.listLocalProfilerReports(connection)).resolves.toEqual([]);
    });

    it('listLocalPerformanceReports returns [] on 204', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockPost = vi.mocked(axiosInstance.default.post);
        mockPost.mockResolvedValue({ status: 204, data: '' } as AxiosResponse);

        const { result } = renderHook(() => useRemoteConnection());
        await expect(result.current.listLocalPerformanceReports(connection)).resolves.toEqual([]);
    });

    it('listLocalProfilerReports returns [] without posting when profilerPath is missing', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockPost = vi.mocked(axiosInstance.default.post);

        const { result } = renderHook(() => useRemoteConnection());
        await expect(
            result.current.listLocalProfilerReports({
                name: 'c',
                host: 'h',
                port: 22,
                username: 'u',
                profilerPath: '',
                performancePath: '/perf',
            }),
        ).resolves.toEqual([]);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it('listLocalPerformanceReports skips POST when performancePath is absent', async () => {
        const axiosInstance = await import('../src/libs/axiosInstance');
        const mockPost = vi.mocked(axiosInstance.default.post);

        const { result } = renderHook(() => useRemoteConnection());
        await expect(
            result.current.listLocalPerformanceReports({
                name: 'c',
                host: 'h',
                port: 22,
                username: 'u',
                profilerPath: '/p',
            }),
        ).resolves.toEqual([]);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it('listLocalProfilerReports throws when host is missing', async () => {
        const { result } = renderHook(() => useRemoteConnection());

        await expect(
            result.current.listLocalProfilerReports({
                name: 'c',
                host: '',
                port: 22,
                username: 'u',
                profilerPath: '/p',
            }),
        ).rejects.toThrow('No connection provided');
    });
});

// The folder caches were keyed by connection name before they moved to name|host|port. Existing
// installs hold entries under the old shape, and nothing else looks them up again — the delete
// paths only ever target the key they were given.
describe('useRemoteConnection - folder cache key migration', () => {
    const connection = {
        name: 'lab',
        host: 'work-gpu',
        port: 22,
        username: 'alice',
        profilerPath: '/reports',
        performancePath: '/perf',
    };
    const reportFolders = [{ remotePath: '/reports/r', reportName: 'r', lastModified: 1 }];
    const performanceFolders = [{ remotePath: '/perf/p', reportName: 'p', lastModified: 2 }];

    it('reads folders still stored under the pre-identity key', () => {
        window.localStorage.setItem(legacySavedReportFoldersKey(connection), JSON.stringify(reportFolders));
        window.localStorage.setItem(legacySavedPerformanceFoldersKey(connection), JSON.stringify(performanceFolders));

        const { result } = renderHook(() => useRemoteConnection());

        expect(result.current.persistentState.getSavedReportFolders(connection)).toEqual(reportFolders);
        expect(result.current.persistentState.getSavedPerformanceFolders(connection)).toEqual(performanceFolders);
    });

    it('rewrites a legacy entry under the identity key and drops the stale one', () => {
        window.localStorage.setItem(legacySavedReportFoldersKey(connection), JSON.stringify(reportFolders));
        window.localStorage.setItem(legacySavedPerformanceFoldersKey(connection), JSON.stringify(performanceFolders));

        const { result } = renderHook(() => useRemoteConnection());
        result.current.persistentState.getSavedReportFolders(connection);
        result.current.persistentState.getSavedPerformanceFolders(connection);

        expect(window.localStorage.getItem(savedReportFoldersKey(connection))).toBe(JSON.stringify(reportFolders));
        expect(window.localStorage.getItem(savedPerformanceFoldersKey(connection))).toBe(
            JSON.stringify(performanceFolders),
        );
        expect(window.localStorage.getItem(legacySavedReportFoldersKey(connection))).toBeNull();
        expect(window.localStorage.getItem(legacySavedPerformanceFoldersKey(connection))).toBeNull();
    });

    it('prefers the identity key when both shapes are present', () => {
        const current = [{ remotePath: '/reports/current', reportName: 'current', lastModified: 3 }];
        window.localStorage.setItem(savedReportFoldersKey(connection), JSON.stringify(current));
        window.localStorage.setItem(legacySavedReportFoldersKey(connection), JSON.stringify(reportFolders));

        const { result } = renderHook(() => useRemoteConnection());

        expect(result.current.persistentState.getSavedReportFolders(connection)).toEqual(current);
    });

    it('does not hand a legacy entry to a same-named connection on a different host', () => {
        window.localStorage.setItem(legacySavedReportFoldersKey(connection), JSON.stringify(reportFolders));

        const { result } = renderHook(() => useRemoteConnection());
        const sameNameOtherHost = { ...connection, host: 'other-gpu' };

        // Whichever connection reads first claims the entry; the loser re-fetches rather than
        // inheriting folders that belong to a different machine.
        expect(result.current.persistentState.getSavedReportFolders(sameNameOtherHost)).toEqual(reportFolders);
        expect(result.current.persistentState.getSavedReportFolders(connection)).toEqual([]);
    });

    it('deleting a connection also clears a legacy entry it never read', () => {
        window.localStorage.setItem(legacySavedReportFoldersKey(connection), JSON.stringify(reportFolders));
        window.localStorage.setItem(legacySavedPerformanceFoldersKey(connection), JSON.stringify(performanceFolders));

        const { result } = renderHook(() => useRemoteConnection());
        result.current.persistentState.deleteSavedReportFolders(connection);
        result.current.persistentState.deleteSavedPerformanceFolders(connection);

        expect(window.localStorage.getItem(legacySavedReportFoldersKey(connection))).toBeNull();
        expect(window.localStorage.getItem(legacySavedPerformanceFoldersKey(connection))).toBeNull();
    });

    it('tolerates a legacy entry that is not an array', () => {
        window.localStorage.setItem(legacySavedReportFoldersKey(connection), JSON.stringify({ nope: true }));

        const { result } = renderHook(() => useRemoteConnection());

        expect(result.current.persistentState.getSavedReportFolders(connection)).toEqual([]);
        expect(window.localStorage.getItem(legacySavedReportFoldersKey(connection))).toBeNull();
    });
});

// The list is read filtered but written whole, so anything the getter hides is erased from
// storage by the next add or edit. Report paths are therefore not part of what makes a
// stored connection listable — the selector flags those rows instead.
describe('useRemoteConnection - savedConnectionList', () => {
    const VALID_CONNECTION = {
        name: 'lab',
        host: 'work-gpu',
        port: 22,
        username: 'alice',
        profilerPath: '/reports',
    };
    const LEGACY_RELATIVE_PATH_CONNECTION = {
        ...VALID_CONNECTION,
        name: 'legacy',
        profilerPath: 'tt-metal/generated/ttnn/reports',
    };

    const seedConnections = (connections: unknown[]) =>
        window.localStorage.setItem(LOCAL_STORAGE_KEY_CONNECTIONS, JSON.stringify(connections));

    it('keeps a connection whose report path the server would now refuse', () => {
        seedConnections([VALID_CONNECTION, LEGACY_RELATIVE_PATH_CONNECTION]);

        const { result } = renderHook(() => useRemoteConnection());

        expect(result.current.persistentState.savedConnectionList).toEqual([
            VALID_CONNECTION,
            LEGACY_RELATIVE_PATH_CONNECTION,
        ]);
    });

    it('still drops an entry missing the fields needed to reach a host', () => {
        seedConnections([VALID_CONNECTION, { name: 'broken', host: 'work-gpu', port: 22 }]);

        const { result } = renderHook(() => useRemoteConnection());

        expect(result.current.persistentState.savedConnectionList).toEqual([VALID_CONNECTION]);
    });

    it('leaves a stored selection with a refused path selected rather than reassigning it', () => {
        seedConnections([VALID_CONNECTION, LEGACY_RELATIVE_PATH_CONNECTION]);
        window.localStorage.setItem(LOCAL_STORAGE_KEY_SELECTED, JSON.stringify(LEGACY_RELATIVE_PATH_CONNECTION));

        const { result } = renderHook(() => useRemoteConnection());

        expect(result.current.persistentState.selectedConnection).toEqual(LEGACY_RELATIVE_PATH_CONNECTION);
    });

    // A non-string path can only arrive from hand-edited or corrupted storage, but the getter
    // feeds a useState initialiser, so throwing there costs the whole page.
    it('does not throw on a connection whose path is not a string', () => {
        seedConnections([{ ...VALID_CONNECTION, profilerPath: 42 }]);

        const { result } = renderHook(() => useRemoteConnection());

        expect(() => result.current.persistentState.savedConnectionList).not.toThrow();
    });
});
