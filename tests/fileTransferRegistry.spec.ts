// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTransferSource } from '../src/definitions/FileTransferSource';
import { REMOTE_SYNC_PROGRESS_STALE_MS } from '../src/definitions/RemoteSync';
import {
    aggregateFileTransferProgress,
    clearAllFileTransferProgress,
    clearFileTransferProgressForSource,
    clearFileTransferProgressForSourceIfInactive,
    clearStaleRemoteSyncOnReconnect,
    fileTransferRegistryAtom,
    getInactiveFileTransferProgress,
    setFileTransferProgressForSource,
} from '../src/store/fileTransferRegistry';
import { beginRemoteSyncRequest, endRemoteSyncRequest } from '../src/functions/remoteSyncRequest';
import { FileStatus } from '../src/model/APIData';
import { fileTransferProgressAtom } from '../src/store/app';

const MLIR_UPLOADING = {
    ...getInactiveFileTransferProgress(),
    currentFileName: 'model.mlir',
    numberOfFiles: 1,
    percentOfCurrent: 50,
    status: FileStatus.UPLOADING,
};

const LOCAL_UPLOADING = {
    ...getInactiveFileTransferProgress(),
    numberOfFiles: 10,
    percentOfCurrent: 25,
    status: FileStatus.UPLOADING,
};

const REMOTE_SYNCING = {
    ...getInactiveFileTransferProgress(),
    currentFileName: 'db.sqlite',
    numberOfFiles: 3,
    finishedFiles: 1,
    percentOfCurrent: 0,
    status: FileStatus.DOWNLOADING,
};

beforeEach(() => {
    clearAllFileTransferProgress();
});

afterEach(() => {
    clearAllFileTransferProgress();
});

describe('aggregateFileTransferProgress', () => {
    it('returns inactive when the registry is empty', () => {
        expect(aggregateFileTransferProgress({})).toEqual(getInactiveFileTransferProgress());
    });

    it('returns a stable inactive reference for empty registries', () => {
        expect(aggregateFileTransferProgress({})).toBe(aggregateFileTransferProgress({}));
    });

    it('prefers MLIR upload over local upload when remote sync is inactive', () => {
        const registry = {
            [FileTransferSource.LOCAL_UPLOAD]: LOCAL_UPLOADING,
            [FileTransferSource.MLIR_UPLOAD]: MLIR_UPLOADING,
        };
        expect(aggregateFileTransferProgress(registry)).toEqual(MLIR_UPLOADING);
    });

    it('returns the only active source', () => {
        const registry = { [FileTransferSource.MLIR_UPLOAD]: MLIR_UPLOADING };
        expect(aggregateFileTransferProgress(registry)).toEqual(MLIR_UPLOADING);
    });

    it('prefers remote sync over other active sources', () => {
        const registry = {
            [FileTransferSource.MLIR_UPLOAD]: MLIR_UPLOADING,
            [FileTransferSource.REMOTE_SYNC]: REMOTE_SYNCING,
            [FileTransferSource.LOCAL_UPLOAD]: LOCAL_UPLOADING,
        };
        expect(aggregateFileTransferProgress(registry)).toEqual(REMOTE_SYNCING);
    });

    it('skips inactive FINISHED slots and picks the next active source', () => {
        const registry = {
            [FileTransferSource.REMOTE_SYNC]: {
                ...REMOTE_SYNCING,
                status: FileStatus.FINISHED,
            },
            [FileTransferSource.MLIR_UPLOAD]: {
                ...MLIR_UPLOADING,
                status: FileStatus.PROCESSING,
            },
        };
        expect(aggregateFileTransferProgress(registry).status).toBe(FileStatus.PROCESSING);
    });

    it('skips FAILED slots so the overlay can follow other active work', () => {
        const registry = {
            [FileTransferSource.REMOTE_SYNC]: {
                ...REMOTE_SYNCING,
                status: FileStatus.FAILED,
            },
            [FileTransferSource.LOCAL_UPLOAD]: LOCAL_UPLOADING,
        };
        expect(aggregateFileTransferProgress(registry)).toEqual(LOCAL_UPLOADING);
    });
});

describe('file transfer registry helpers', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-14T12:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('keeps other sources active when one source is cleared', () => {
        setFileTransferProgressForSource(FileTransferSource.MLIR_UPLOAD, MLIR_UPLOADING);
        setFileTransferProgressForSource(FileTransferSource.LOCAL_UPLOAD, LOCAL_UPLOADING);

        clearFileTransferProgressForSource(FileTransferSource.LOCAL_UPLOAD);

        expect(getDefaultStore().get(fileTransferRegistryAtom)[FileTransferSource.LOCAL_UPLOAD]).toBeUndefined();
        expect(getDefaultStore().get(fileTransferRegistryAtom)[FileTransferSource.MLIR_UPLOAD]).toMatchObject(
            MLIR_UPLOADING,
        );
        expect(getDefaultStore().get(fileTransferProgressAtom).status).toBe(FileStatus.UPLOADING);
    });

    it('returns inactive aggregate after the last active source is cleared', () => {
        setFileTransferProgressForSource(FileTransferSource.MLIR_UPLOAD, MLIR_UPLOADING);
        clearFileTransferProgressForSource(FileTransferSource.MLIR_UPLOAD);

        expect(getDefaultStore().get(fileTransferProgressAtom)).toEqual(getInactiveFileTransferProgress());
    });

    it('setFileTransferProgressForSource stamps updatedAtMs', () => {
        setFileTransferProgressForSource(FileTransferSource.REMOTE_SYNC, REMOTE_SYNCING);

        expect(getDefaultStore().get(fileTransferRegistryAtom)[FileTransferSource.REMOTE_SYNC]).toMatchObject({
            ...REMOTE_SYNCING,
            updatedAtMs: Date.now(),
        });
    });

    it('clearFileTransferProgressForSourceIfInactive removes terminal remote sync slots', () => {
        setFileTransferProgressForSource(FileTransferSource.MLIR_UPLOAD, MLIR_UPLOADING);
        setFileTransferProgressForSource(FileTransferSource.REMOTE_SYNC, {
            ...REMOTE_SYNCING,
            status: FileStatus.FINISHED,
        });

        clearFileTransferProgressForSourceIfInactive(FileTransferSource.REMOTE_SYNC);

        const registry = getDefaultStore().get(fileTransferRegistryAtom);
        expect(registry[FileTransferSource.REMOTE_SYNC]).toBeUndefined();
        expect(registry[FileTransferSource.MLIR_UPLOAD]).toMatchObject(MLIR_UPLOADING);
    });

    it('clearFileTransferProgressForSourceIfInactive preserves active slots when staleAfterMs is omitted', () => {
        setFileTransferProgressForSource(FileTransferSource.REMOTE_SYNC, REMOTE_SYNCING);
        vi.advanceTimersByTime(REMOTE_SYNC_PROGRESS_STALE_MS);

        clearFileTransferProgressForSourceIfInactive(FileTransferSource.REMOTE_SYNC);

        expect(getDefaultStore().get(fileTransferRegistryAtom)[FileTransferSource.REMOTE_SYNC]).toMatchObject(
            REMOTE_SYNCING,
        );
    });

    it('clearFileTransferProgressForSourceIfInactive preserves a fresh active remote sync slot', () => {
        setFileTransferProgressForSource(FileTransferSource.REMOTE_SYNC, REMOTE_SYNCING);

        clearFileTransferProgressForSourceIfInactive(FileTransferSource.REMOTE_SYNC, {
            staleAfterMs: REMOTE_SYNC_PROGRESS_STALE_MS,
        });

        expect(getDefaultStore().get(fileTransferRegistryAtom)[FileTransferSource.REMOTE_SYNC]).toMatchObject(
            REMOTE_SYNCING,
        );
    });

    it('clearFileTransferProgressForSourceIfInactive preserves an active slot just inside the stale window', () => {
        setFileTransferProgressForSource(FileTransferSource.REMOTE_SYNC, REMOTE_SYNCING);
        vi.advanceTimersByTime(REMOTE_SYNC_PROGRESS_STALE_MS - 1);

        clearFileTransferProgressForSourceIfInactive(FileTransferSource.REMOTE_SYNC, {
            staleAfterMs: REMOTE_SYNC_PROGRESS_STALE_MS,
        });

        expect(getDefaultStore().get(fileTransferRegistryAtom)[FileTransferSource.REMOTE_SYNC]).toMatchObject(
            REMOTE_SYNCING,
        );
    });

    it('clearFileTransferProgressForSourceIfInactive clears a stale active remote sync slot', () => {
        setFileTransferProgressForSource(FileTransferSource.REMOTE_SYNC, REMOTE_SYNCING);
        vi.advanceTimersByTime(REMOTE_SYNC_PROGRESS_STALE_MS);

        clearFileTransferProgressForSourceIfInactive(FileTransferSource.REMOTE_SYNC, {
            staleAfterMs: REMOTE_SYNC_PROGRESS_STALE_MS,
        });

        expect(getDefaultStore().get(fileTransferRegistryAtom)[FileTransferSource.REMOTE_SYNC]).toBeUndefined();
        expect(getDefaultStore().get(fileTransferProgressAtom)).toEqual(getInactiveFileTransferProgress());
    });

    it('clearFileTransferProgressForSourceIfInactive clears active slots without updatedAtMs when aging', () => {
        getDefaultStore().set(fileTransferRegistryAtom, {
            [FileTransferSource.REMOTE_SYNC]: REMOTE_SYNCING,
        });

        clearFileTransferProgressForSourceIfInactive(FileTransferSource.REMOTE_SYNC, {
            staleAfterMs: REMOTE_SYNC_PROGRESS_STALE_MS,
        });

        expect(getDefaultStore().get(fileTransferRegistryAtom)[FileTransferSource.REMOTE_SYNC]).toBeUndefined();
    });

    it('clearFileTransferProgressForSourceIfInactive removes FAILED remote sync slots', () => {
        setFileTransferProgressForSource(FileTransferSource.MLIR_UPLOAD, MLIR_UPLOADING);
        setFileTransferProgressForSource(FileTransferSource.REMOTE_SYNC, {
            ...REMOTE_SYNCING,
            status: FileStatus.FAILED,
        });

        clearFileTransferProgressForSourceIfInactive(FileTransferSource.REMOTE_SYNC);

        const registry = getDefaultStore().get(fileTransferRegistryAtom);
        expect(registry[FileTransferSource.REMOTE_SYNC]).toBeUndefined();
        expect(registry[FileTransferSource.MLIR_UPLOAD]).toMatchObject(MLIR_UPLOADING);
    });

    it('clearStaleRemoteSyncOnReconnect aborts an in-flight sync when clearing a stale active slot', () => {
        const abortController = beginRemoteSyncRequest();
        setFileTransferProgressForSource(FileTransferSource.REMOTE_SYNC, REMOTE_SYNCING);
        vi.advanceTimersByTime(REMOTE_SYNC_PROGRESS_STALE_MS);

        expect(clearStaleRemoteSyncOnReconnect()).toBe(true);

        expect(getDefaultStore().get(fileTransferRegistryAtom)[FileTransferSource.REMOTE_SYNC]).toBeUndefined();
        expect(abortController.signal.aborted).toBe(true);
    });

    it('clearStaleRemoteSyncOnReconnect preserves a fresh active slot without aborting', () => {
        const abortController = beginRemoteSyncRequest();
        setFileTransferProgressForSource(FileTransferSource.REMOTE_SYNC, REMOTE_SYNCING);

        expect(clearStaleRemoteSyncOnReconnect()).toBe(false);

        expect(getDefaultStore().get(fileTransferRegistryAtom)[FileTransferSource.REMOTE_SYNC]).toMatchObject(
            REMOTE_SYNCING,
        );
        expect(abortController.signal.aborted).toBe(false);
        endRemoteSyncRequest(abortController);
    });
});
