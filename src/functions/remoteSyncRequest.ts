// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Tracks the in-flight `/api/remote/sync` AbortController so a reconnect that
 * drops an orphaned REMOTE_SYNC slot can also unblock the component-local
 * `isSyncing` lock (axios must reject for `finally` to run).
 */
let activeRemoteSyncAbortController: AbortController | null = null;

export function beginRemoteSyncRequest(): AbortController {
    // Only one folder sync is interactive at a time; replace any prior controller
    // so a late abort cannot cancel a newer request.
    activeRemoteSyncAbortController = new AbortController();
    return activeRemoteSyncAbortController;
}

export function endRemoteSyncRequest(controller: AbortController): void {
    if (activeRemoteSyncAbortController === controller) {
        activeRemoteSyncAbortController = null;
    }
}

export function abortActiveRemoteSyncRequest(): void {
    if (!activeRemoteSyncAbortController) {
        return;
    }

    activeRemoteSyncAbortController.abort();
    activeRemoteSyncAbortController = null;
}
