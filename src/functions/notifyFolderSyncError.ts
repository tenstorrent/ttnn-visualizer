// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios from 'axios';
import createToastNotification, { ToastType } from './createToastNotification';
import getResponseError from './getResponseError';

/**
 * Surfaces sync failures except intentional cancels (orphan reconnect abort).
 */
export default function notifyFolderSyncError(err: unknown): void {
    if (axios.isCancel(err)) {
        return;
    }

    createToastNotification('Folder sync error', getResponseError(err), ToastType.ERROR);
}
