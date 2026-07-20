// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios from 'axios';
import { RemoteFolder } from '../definitions/RemoteConnection';

export enum RemoteSyncFailureAction {
    IGNORE_CANCEL = 'ignore-cancel',
    FALLBACK_LOCAL = 'fallback-local',
    SHOW_ERROR = 'show-error',
}

/**
 * Decides how to handle a failed remote sync.
 * When a folder was selected, prefer mounting the on-disk copy over a hard error —
 * lastSynced metadata is often missing even when files were synced earlier.
 */
export default function getRemoteSyncFailureAction(
    err: unknown,
    folder?: RemoteFolder | null,
): RemoteSyncFailureAction {
    if (axios.isCancel(err)) {
        return RemoteSyncFailureAction.IGNORE_CANCEL;
    }

    if (folder) {
        return RemoteSyncFailureAction.FALLBACK_LOCAL;
    }

    return RemoteSyncFailureAction.SHOW_ERROR;
}
