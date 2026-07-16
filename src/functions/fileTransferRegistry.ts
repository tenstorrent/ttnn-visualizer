// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import { getDefaultStore } from 'jotai/vanilla';
import { FileTransferSource } from '../definitions/FileTransferSource';
import { REMOTE_SYNC_PROGRESS_STALE_MS } from '../definitions/RemoteSync';
import { FileProgress, FileStatus } from '../model/APIData';
import { isActiveTransferStatus } from './getFileStatusLabel';
import { abortActiveRemoteSyncRequest } from './remoteSyncRequest';

export interface ClearFileTransferIfInactiveOptions {
    /**
     * When set, also drop active slots that are missing `updatedAtMs` or not
     * fresher than this window. Omit to keep the classic terminal-only clear
     * (active slots are always preserved). Callers that need remote-sync orphan
     * cleanup must pass their own policy (e.g. `REMOTE_SYNC_PROGRESS_STALE_MS`).
     */
    staleAfterMs?: number;
    /** Injected clock for deterministic tests. Defaults to Date.now(). */
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
 * Drops a terminal source slot. When `staleAfterMs` is provided, also drops
 * active slots that are missing a freshness stamp or are at least as old as
 * that window — so a reconnect can clear orphaned DOWNLOADING state after
 * backend death without a FAILED event (#1757), while fresh mid-transfer
 * progress (axios still running) is kept.
 *
 * Returns whether the source slot was removed from the registry.
 */
export function clearFileTransferProgressForSourceIfInactive(
    source: FileTransferSource,
    options: ClearFileTransferIfInactiveOptions = {},
): boolean {
    const { staleAfterMs, nowMs = Date.now() } = options;
    let didClear = false;

    getDefaultStore().set(fileTransferRegistryAtom, (registry) => {
        const progress = registry[source];
        if (progress && isActiveTransferStatus(progress.status)) {
            if (staleAfterMs === undefined) {
                return registry;
            }

            const { updatedAtMs } = progress;
            if (updatedAtMs !== undefined && nowMs - updatedAtMs < staleAfterMs) {
                return registry;
            }
        }

        if (!(source in registry)) {
            return registry;
        }

        didClear = true;
        const { [source]: _removed, ...rest } = registry;
        return rest;
    });

    return didClear;
}

/**
 * REMOTE_SYNC reconnect policy for #1757: drop terminal or orphaned slots, and
 * abort a hanging `/api/remote/sync` when an *active* orphan is removed so the
 * UI `isSyncing` lock can release. Not timer-driven — if the socket never
 * reconnects, the axios timeout in `syncRemoteFolder` is the backstop.
 *
 * Returns whether an in-flight sync abort was requested.
 */
export function clearStaleRemoteSyncOnReconnect(options: { nowMs?: number } = {}): boolean {
    const progress = getDefaultStore().get(fileTransferRegistryAtom)[FileTransferSource.REMOTE_SYNC];
    const wasActive = progress !== undefined && isActiveTransferStatus(progress.status);

    const didClear = clearFileTransferProgressForSourceIfInactive(FileTransferSource.REMOTE_SYNC, {
        staleAfterMs: REMOTE_SYNC_PROGRESS_STALE_MS,
        nowMs: options.nowMs,
    });

    if (wasActive && didClear) {
        abortActiveRemoteSyncRequest();
        return true;
    }

    return false;
}

export function clearAllFileTransferProgress(): void {
    getDefaultStore().set(fileTransferRegistryAtom, {});
}
