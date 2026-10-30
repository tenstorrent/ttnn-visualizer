// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { RemoteFolder } from '../model/RemoteConnection';

/**
 * The backend's listing order (`remote_folder_newest_first_key` in `models.py`),
 * for re-sorting a list after one row's time changes without a fresh listing.
 *
 * `remotePath` is compared by code point, not `localeCompare`, so ties break the
 * way Python's string ordering breaks them.
 */
export default function compareRemoteFoldersNewestFirst(a: RemoteFolder, b: RemoteFolder): number {
    if (a.lastModified !== b.lastModified) {
        return b.lastModified - a.lastModified;
    }

    if (a.remotePath === b.remotePath) {
        return 0;
    }

    return a.remotePath < b.remotePath ? -1 : 1;
}
