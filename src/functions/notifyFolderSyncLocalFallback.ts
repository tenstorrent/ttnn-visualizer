// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import createToastNotification from './createToastNotification';
import { ToastType } from '../definitions/ToastType';
import getResponseError from './getResponseError';

export const FOLDER_SYNC_LOCAL_FALLBACK_TOAST_TITLE = 'Loaded local copy';
export const FOLDER_SYNC_LOCAL_FALLBACK_TOAST_DETAIL_PREFIX =
    'Could not sync from remote; using previously synced report.';

export const LOCAL_SYNCED_REPORTS_TOAST_TITLE = 'Loaded local synced reports';
export const LOCAL_SYNCED_REPORTS_TOAST_DETAIL =
    'Remote host unreachable; showing reports already synced on this machine.';

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

/** Warns that the remote folder list fell back to on-disk synced copies. */
export function notifyLocalSyncedReportsListFallback(): void {
    createToastNotification(LOCAL_SYNCED_REPORTS_TOAST_TITLE, LOCAL_SYNCED_REPORTS_TOAST_DETAIL, ToastType.WARNING);
}
