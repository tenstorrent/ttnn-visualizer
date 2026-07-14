// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import { getDefaultStore } from 'jotai/vanilla';
import { REMOTE_SYNC_PROGRESS_STALE_MS } from '../definitions/FileTransfer';
import { FileTransferSource } from '../definitions/FileTransferSource';
import { FileProgress, FileStatus } from '../model/APIData';
import { isActiveTransferStatus } from './getFileStatusLabel';

export interface ClearFileTransferIfInactiveOptions {
    staleAfterMs?: number;
    nowMs?: number;
}

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

// Overlay collision order when multiple sources are mid-transfer: remote sync is
// the most disruptive (full-report folder copy), then MLIR upload, then a local
// file drop. Do not reorder casually.
const FILE_TRANSFER_SOURCE_PRIORITY: readonly FileTransferSource[] = [
    FileTransferSource.REMOTE_SYNC,
    FileTransferSource.MLIR_UPLOAD,
    FileTransferSource.LOCAL_UPLOAD,
];

// Atoms are co-located with mutators here rather than in store/app.ts to avoid a circular
// import: app.ts derives fileTransferProgressAtom from aggregateFileTransferProgress, while
// setters need fileTransferRegistryAtom. Both are re-exported from store/app.ts.
export const fileTransferRegistryAtom = atom<FileTransferRegistry>({});

export const fileTransferProgressBySourceAtom = atomFamily((source: FileTransferSource) =>
    atom((get) => get(fileTransferRegistryAtom)[source] ?? INACTIVE_FILE_TRANSFER_PROGRESS),
);

/**
 * Picks the highest-priority *active* transfer for the overlay.
 *
 * Terminal statuses (`FINISHED`, `FAILED`, `INACTIVE`) are skipped so a failed
 * or finished high-priority slot cannot hide an active lower-priority one.
 * Error surfacing is owned by toasts / connection UI — the overlay only tracks
 * live work.
 */
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
        [source]: {
            ...progress,
            updatedAtMs: Date.now(),
        },
    }));
}

export function clearFileTransferProgressForSource(source: FileTransferSource): void {
    getDefaultStore().set(fileTransferRegistryAtom, (registry) => {
        const { [source]: _removed, ...rest } = registry;
        return rest;
    });
}

/**
 * Drops a source slot that is terminal, missing a freshness stamp, or older than
 * the staleness window. Fresh active slots are kept so a socket reconnect mid-
 * transfer does not wipe live progress while axios is still running.
 *
 * Stale-but-still-"active" slots cover backend death mid-transfer: the process
 * vanishes without a terminal FAILED, reconnect would otherwise preserve
 * DOWNLOADING forever (#1757).
 */
export function clearFileTransferProgressForSourceIfInactive(
    source: FileTransferSource,
    options: ClearFileTransferIfInactiveOptions = {},
): void {
    const staleAfterMs = options.staleAfterMs ?? REMOTE_SYNC_PROGRESS_STALE_MS;
    const nowMs = options.nowMs ?? Date.now();

    getDefaultStore().set(fileTransferRegistryAtom, (registry) => {
        const progress = registry[source];
        if (progress && isActiveTransferStatus(progress.status)) {
            const { updatedAtMs } = progress;
            if (updatedAtMs !== undefined && nowMs - updatedAtMs < staleAfterMs) {
                return registry;
            }
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
