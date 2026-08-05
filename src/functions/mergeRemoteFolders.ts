// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { RemoteFolder } from '../definitions/RemoteConnection';

/**
 * Merge a fresh folder list onto cached rows. Prefer the update's lastSynced when the
 * key is present (including explicit null = not synced); keep the cache only when omitted.
 *
 * Rows are matched on `remotePath`: every rank of one multihost launch shares a
 * report name, so matching on that would fold them onto one cache entry.
 */
export default function mergeRemoteFolders(
    savedFolders: RemoteFolder[] | undefined,
    updatedFolders: RemoteFolder[],
): RemoteFolder[] {
    return (updatedFolders ?? []).map((updatedFolder) => {
        const existingFolder = savedFolders?.find((f) => f.remotePath === updatedFolder.remotePath);

        return {
            ...existingFolder,
            ...updatedFolder,
            lastSynced: updatedFolder.lastSynced !== undefined ? updatedFolder.lastSynced : existingFolder?.lastSynced,
        };
    });
}
