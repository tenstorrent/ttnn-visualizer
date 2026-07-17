// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { RemoteFolder } from '../definitions/RemoteConnection';

/**
 * Merge a fresh folder list onto cached rows. Prefer the update's lastSynced when the
 * key is present (including explicit null = not synced); keep the cache only when omitted.
 */
export default function mergeRemoteFolders(
    savedFolders: RemoteFolder[] | undefined,
    updatedFolders: RemoteFolder[],
): RemoteFolder[] {
    return (updatedFolders ?? []).map((updatedFolder) => {
        const existingFolder = savedFolders?.find((f) => f.reportName === updatedFolder.reportName);

        return {
            ...existingFolder,
            ...updatedFolder,
            lastSynced: updatedFolder.lastSynced !== undefined ? updatedFolder.lastSynced : existingFolder?.lastSynced,
        };
    });
}
