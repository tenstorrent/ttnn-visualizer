// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosProgressEvent } from 'axios';
import useMlirRemote from '../src/hooks/useMlirRemote';
import axiosInstance from '../src/libs/axiosInstance';
import { ConnectionTestStates } from '../src/definitions/ConnectionStatus';
import { MlirServerConnection } from '../src/definitions/MlirServer';
import FileStatusOverlay from '../src/components/FileStatusOverlay';
import MlirJsonFileLoader from '../src/components/mlir/MlirJsonFileLoader';
import { fileTransferProgressAtom, getInactiveFileTransferProgress } from '../src/store/app';
import { FileStatus } from '../src/model/APIData';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        post: vi.fn(),
    },
}));

const SERVER: MlirServerConnection = {
    name: 'Test host',
    username: 'tt',
    host: 'worker-01',
    sshPort: 22,
    port: 8080,
};

function toFileList(files: File[]): FileList {
    const dataTransfer = new DataTransfer();
    files.forEach((file) => dataTransfer.items.add(file));
    return dataTransfer.files;
}

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
    let deferredResolve!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
        deferredResolve = resolve;
    });
    return { promise, resolve: deferredResolve };
}

beforeEach(() => {
    vi.resetAllMocks();
    getDefaultStore().set(fileTransferProgressAtom, getInactiveFileTransferProgress());
});

afterEach(() => {
    cleanup();
    getDefaultStore().set(fileTransferProgressAtom, getInactiveFileTransferProgress());
});

describe('useMlirRemote progress lifecycle', () => {
    it('ignores zero-total upload progress events and keeps overlay state stable', async () => {
        const postMock = vi.mocked(axiosInstance.post);
        const deferred = createDeferred<{ data: { status: ConnectionTestStates } }>();
        let onUploadProgress: ((event: AxiosProgressEvent) => void) | undefined;

        postMock.mockImplementation((_url, _data, config) => {
            onUploadProgress = config?.onUploadProgress;
            return deferred.promise;
        });

        const { result } = renderHook(() => useMlirRemote());
        const uploadPromise = result.current.uploadMlirFileToServer(
            toFileList([new File(['module {}'], 'model.mlir')]),
            SERVER,
        );

        await waitFor(() => {
            expect(getDefaultStore().get(fileTransferProgressAtom).status).toBe(FileStatus.UPLOADING);
        });

        onUploadProgress?.({ loaded: 0, total: 0 } as AxiosProgressEvent);

        const progressAfterZeroTotal = getDefaultStore().get(fileTransferProgressAtom);
        expect(progressAfterZeroTotal.status).toBe(FileStatus.UPLOADING);
        expect(progressAfterZeroTotal.percentOfCurrent).toBe(0);
        expect(progressAfterZeroTotal.bytesTotal).toBeUndefined();

        deferred.resolve({ data: { status: ConnectionTestStates.OK } });
        await uploadPromise;

        expect(getDefaultStore().get(fileTransferProgressAtom)).toEqual(getInactiveFileTransferProgress());
    });

    it('transitions UPLOADING to PROCESSING and resets to INACTIVE on request completion', async () => {
        const postMock = vi.mocked(axiosInstance.post);
        const deferred = createDeferred<{ data: { status: ConnectionTestStates } }>();
        let onUploadProgress: ((event: AxiosProgressEvent) => void) | undefined;

        postMock.mockImplementation((_url, _data, config) => {
            onUploadProgress = config?.onUploadProgress;
            return deferred.promise;
        });

        const { result } = renderHook(() => useMlirRemote());
        const uploadPromise = result.current.uploadMlirFileToServer(
            toFileList([new File(['module {}'], 'model.mlir')]),
            SERVER,
        );

        onUploadProgress?.({ loaded: 5, total: 10 } as AxiosProgressEvent);
        let progress = getDefaultStore().get(fileTransferProgressAtom);
        expect(progress.status).toBe(FileStatus.UPLOADING);
        expect(progress.percentOfCurrent).toBe(50);

        onUploadProgress?.({ loaded: 10, total: 10 } as AxiosProgressEvent);
        progress = getDefaultStore().get(fileTransferProgressAtom);
        expect(progress.status).toBe(FileStatus.PROCESSING);
        expect(progress.percentOfCurrent).toBe(100);

        deferred.resolve({ data: { status: ConnectionTestStates.OK } });
        await uploadPromise;

        expect(getDefaultStore().get(fileTransferProgressAtom)).toEqual(getInactiveFileTransferProgress());
    });

    it('shows overlay transition from upload to processing and closes when the request resolves', async () => {
        const postMock = vi.mocked(axiosInstance.post);
        const deferred = createDeferred<{ data: { status: ConnectionTestStates; graph: null; name: string } }>();
        let onUploadProgress: ((event: AxiosProgressEvent) => void) | undefined;

        postMock.mockImplementation((_url, _data, config) => {
            onUploadProgress = config?.onUploadProgress;
            return deferred.promise;
        });

        const { container } = render(
            <MemoryRouter>
                <MlirJsonFileLoader server={SERVER} />
                <FileStatusOverlay />
            </MemoryRouter>,
        );

        const fileInput = container.querySelector('input[type="file"]');
        expect(fileInput).not.toBeNull();

        const file = new File(['module {}'], 'model.mlir');
        fireEvent.change(fileInput as HTMLInputElement, {
            target: { files: [file] },
        });

        await waitFor(() => {
            expect(postMock).toHaveBeenCalledTimes(1);
            expect(screen.getByText('Uploading report')).toBeInTheDocument();
        });

        onUploadProgress?.({ loaded: 10, total: 10 } as AxiosProgressEvent);

        await waitFor(() => {
            expect(screen.getByText('Processing report')).toBeInTheDocument();
        });

        deferred.resolve({
            data: {
                status: ConnectionTestStates.OK,
                graph: null,
                name: 'model',
            },
        });

        await waitFor(() => {
            expect(screen.queryByText('Processing report')).not.toBeInTheDocument();
            expect(getDefaultStore().get(fileTransferProgressAtom).status).toBe(FileStatus.INACTIVE);
        });
    });
});
