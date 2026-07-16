// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import createToastNotification, { ToastType } from './createToastNotification';
import getResponseError from './getResponseError';

export const FOLDER_SYNC_LOCAL_FALLBACK_TOAST_TITLE = 'Loaded local copy';
export const FOLDER_SYNC_LOCAL_FALLBACK_TOAST_DETAIL_PREFIX =
    'Could not sync from remote; using previously synced report.';

/**
 * Warns that sync failed but a previously synced local copy will be used instead.
 */
export default function notifyFolderSyncLocalFallback(err: unknown): void {
    createToastNotification(
        FOLDER_SYNC_LOCAL_FALLBACK_TOAST_TITLE,
        `${FOLDER_SYNC_LOCAL_FALLBACK_TOAST_DETAIL_PREFIX} ${getResponseError(err)}`,
        ToastType.WARNING,
    );
}
