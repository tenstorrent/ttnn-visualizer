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

    return compareByCodePoint(a.remotePath, b.remotePath);
}

// `<` compares UTF-16 code units, which put a character past U+FFFF (an emoji, say)
// before U+E000–U+FFFF, where Python puts it after.
function compareByCodePoint(left: string, right: string): number {
    let index = 0;
    while (index < left.length && index < right.length) {
        const leftPoint = left.codePointAt(index) ?? 0;
        const rightPoint = right.codePointAt(index) ?? 0;
        if (leftPoint !== rightPoint) {
            return leftPoint < rightPoint ? -1 : 1;
        }
        index += leftPoint > 0xffff ? 2 : 1;
    }

    return Math.sign(left.length - right.length);
}
