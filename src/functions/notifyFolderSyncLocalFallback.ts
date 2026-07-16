// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import createToastNotification, { ToastType } from './createToastNotification';
import getResponseError from './getResponseError';

/**
 * Warns that sync failed but a previously synced local copy will be used instead.
 */
export default function notifyFolderSyncLocalFallback(err: unknown): void {
    createToastNotification(
        'Loaded local copy',
        `Could not sync from remote; using previously synced report. ${getResponseError(err)}`,
        ToastType.WARNING,
    );
}
