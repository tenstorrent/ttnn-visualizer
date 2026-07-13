// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileTransferSource } from '../src/definitions/FileTransferSource';
import {
    aggregateFileTransferProgress,
    clearAllFileTransferProgress,
    clearFileTransferProgressForSource,
    clearFileTransferProgressForSourceIfInactive,
    fileTransferRegistryAtom,
    getInactiveFileTransferProgress,
    setFileTransferProgressForSource,
} from '../src/functions/fileTransferRegistry';
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
    it('keeps other sources active when one source is cleared', () => {
        setFileTransferProgressForSource(FileTransferSource.MLIR_UPLOAD, MLIR_UPLOADING);
        setFileTransferProgressForSource(FileTransferSource.LOCAL_UPLOAD, LOCAL_UPLOADING);

        clearFileTransferProgressForSource(FileTransferSource.LOCAL_UPLOAD);

        expect(getDefaultStore().get(fileTransferRegistryAtom)[FileTransferSource.LOCAL_UPLOAD]).toBeUndefined();
        expect(getDefaultStore().get(fileTransferRegistryAtom)[FileTransferSource.MLIR_UPLOAD]).toEqual(MLIR_UPLOADING);
        expect(getDefaultStore().get(fileTransferProgressAtom).status).toBe(FileStatus.UPLOADING);
    });

    it('returns inactive aggregate after the last active source is cleared', () => {
        setFileTransferProgressForSource(FileTransferSource.MLIR_UPLOAD, MLIR_UPLOADING);
        clearFileTransferProgressForSource(FileTransferSource.MLIR_UPLOAD);

        expect(getDefaultStore().get(fileTransferProgressAtom)).toEqual(getInactiveFileTransferProgress());
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
        expect(registry[FileTransferSource.MLIR_UPLOAD]).toEqual(MLIR_UPLOADING);
    });

    it('clearFileTransferProgressForSourceIfInactive preserves an active remote sync slot', () => {
        setFileTransferProgressForSource(FileTransferSource.REMOTE_SYNC, REMOTE_SYNCING);

        clearFileTransferProgressForSourceIfInactive(FileTransferSource.REMOTE_SYNC);

        expect(getDefaultStore().get(fileTransferRegistryAtom)[FileTransferSource.REMOTE_SYNC]).toEqual(REMOTE_SYNCING);
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
        expect(registry[FileTransferSource.MLIR_UPLOAD]).toEqual(MLIR_UPLOADING);
    });
});
