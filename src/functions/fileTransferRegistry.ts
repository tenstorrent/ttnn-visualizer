// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import { getDefaultStore } from 'jotai/vanilla';
import { FileTransferSource } from '../definitions/FileTransferSource';
import { FileProgress, FileStatus } from '../model/APIData';
import { isActiveTransferStatus } from './getFileStatusLabel';

/** Fresh inactive progress snapshot. Always call this for resets — do not reuse a shared object or spread `previous`, or stale `numberOfFiles` / byte fields can linger. */
export function getInactiveFileTransferProgress(): FileProgress {
    return {
        currentFileName: '',
        numberOfFiles: 0,
        percentOfCurrent: 0,
        finishedFiles: 0,
        status: FileStatus.INACTIVE,
    };
}

/** Stable read-only fallback so per-source subscribers do not re-render on unrelated registry updates. */
const INACTIVE_FILE_TRANSFER_PROGRESS: FileProgress = Object.freeze(getInactiveFileTransferProgress());

export type FileTransferRegistry = Partial<Record<FileTransferSource, FileProgress>>;

const FILE_TRANSFER_SOURCE_PRIORITY: readonly FileTransferSource[] = [
    FileTransferSource.REMOTE_SYNC,
    FileTransferSource.MLIR_UPLOAD,
    FileTransferSource.LOCAL_UPLOAD,
];

export const fileTransferRegistryAtom = atom<FileTransferRegistry>({});

export const fileTransferProgressBySourceAtom = atomFamily((source: FileTransferSource) =>
    atom((get) => get(fileTransferRegistryAtom)[source] ?? INACTIVE_FILE_TRANSFER_PROGRESS),
);

export function aggregateFileTransferProgress(registry: FileTransferRegistry): FileProgress {
    for (const source of FILE_TRANSFER_SOURCE_PRIORITY) {
        const progress = registry[source];
        if (progress && isActiveTransferStatus(progress.status)) {
            return progress;
        }
    }

    return INACTIVE_FILE_TRANSFER_PROGRESS;
}

export function setFileTransferProgressForSource(source: FileTransferSource, progress: FileProgress): void {
    getDefaultStore().set(fileTransferRegistryAtom, (registry) => ({
        ...registry,
        [source]: progress,
    }));
}

export function clearFileTransferProgressForSource(source: FileTransferSource): void {
    getDefaultStore().set(fileTransferRegistryAtom, (registry) => {
        const { [source]: _removed, ...rest } = registry;
        return rest;
    });
}

export function clearFileTransferProgressForSourceIfInactive(source: FileTransferSource): void {
    getDefaultStore().set(fileTransferRegistryAtom, (registry) => {
        const progress = registry[source];
        if (progress && isActiveTransferStatus(progress.status)) {
            return registry;
        }

        if (!(source in registry)) {
            return registry;
        }

        const { [source]: _removed, ...rest } = registry;
        return rest;
    });
}

export function clearAllFileTransferProgress(): void {
    getDefaultStore().set(fileTransferRegistryAtom, {});
}
