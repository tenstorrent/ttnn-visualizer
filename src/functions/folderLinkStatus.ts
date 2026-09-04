// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { FolderLinkState } from '../definitions/FolderLinkStatus';

export const getFolderLinkState = (
    reportId: string | null,
    linkedIds?: Set<string> | null,
    unlinkedIds?: Set<string> | null,
): FolderLinkState => {
    if (reportId && linkedIds?.has(reportId)) {
        return FolderLinkState.LINKED;
    }

    if (reportId && unlinkedIds?.has(reportId)) {
        return FolderLinkState.UNLINKED;
    }

    return FolderLinkState.UNKNOWN;
};

/** True when badge sets are present and at least one known link/unlinked id exists. */
export const shouldShowFolderLinkStatus = (linkedIds?: Set<string> | null, unlinkedIds?: Set<string> | null): boolean =>
    Boolean(linkedIds?.size || unlinkedIds?.size);
