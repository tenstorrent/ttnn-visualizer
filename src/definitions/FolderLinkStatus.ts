// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

export enum FolderLinkState {
    LINKED = 'linked',
    UNLINKED = 'unlinked',
    UNKNOWN = 'unknown',
}

export const FOLDER_LINK_STATUS = {
    [FolderLinkState.LINKED]: {
        tooltip: 'Successfully linked with the active report',
        icon: IconNames.LINK,
        intent: Intent.SUCCESS,
    },
    [FolderLinkState.UNLINKED]: {
        tooltip: 'Failed to link with the active report',
        icon: IconNames.UNLINK,
        intent: Intent.WARNING,
    },
    [FolderLinkState.UNKNOWN]: {
        tooltip: 'Link status unknown',
        icon: IconNames.LINK,
        intent: Intent.NONE,
    },
} as const;

export const getFolderLinkState = (
    reportId: string | null,
    linkedIds?: Set<string>,
    unlinkedIds?: Set<string>,
): FolderLinkState => {
    if (reportId && linkedIds?.has(reportId)) {
        return FolderLinkState.LINKED;
    }

    if (reportId && unlinkedIds?.has(reportId)) {
        return FolderLinkState.UNLINKED;
    }

    return FolderLinkState.UNKNOWN;
};

/** Linked first, unknown middle, failed links last — stable within each group. */
const FOLDER_LINK_SORT_RANK: Record<FolderLinkState, number> = {
    [FolderLinkState.LINKED]: 0,
    [FolderLinkState.UNKNOWN]: 1,
    [FolderLinkState.UNLINKED]: 2,
};

export const compareByFolderLinkState = (
    aId: string | null,
    bId: string | null,
    linkedIds?: Set<string>,
    unlinkedIds?: Set<string>,
): number =>
    FOLDER_LINK_SORT_RANK[getFolderLinkState(aId, linkedIds, unlinkedIds)] -
    FOLDER_LINK_SORT_RANK[getFolderLinkState(bId, linkedIds, unlinkedIds)];
