// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { renderHook } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTransferSource } from '../src/definitions/FileTransferSource';
import { REMOTE_SYNC_REQUEST_TIMEOUT_MS } from '../src/definitions/RemoteSync';
import { StackSourceOrigin } from '../src/definitions/StackTrace';
import {
    clearAllFileTransferProgress,
    fileTransferRegistryAtom,
    getInactiveFileTransferProgress,
    setFileTransferProgressForSource,
} from '../src/functions/fileTransferRegistry';
import { abortActiveRemoteSyncRequest } from '../src/functions/remoteSyncRequest';
import useRemoteConnection from '../src/hooks/useRemote';
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
