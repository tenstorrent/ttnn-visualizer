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

/** Linked first, unknown middle, failed links last — stable within each group. */
const FOLDER_LINK_SORT_RANK: Record<FolderLinkState, number> = {
    [FolderLinkState.LINKED]: 0,
    [FolderLinkState.UNKNOWN]: 1,
    [FolderLinkState.UNLINKED]: 2,
};

export const compareByFolderLinkState = (
    aId: string | null,
    bId: string | null,
    linkedIds?: Set<string> | null,
    unlinkedIds?: Set<string> | null,
): number =>
    FOLDER_LINK_SORT_RANK[getFolderLinkState(aId, linkedIds, unlinkedIds)] -
    FOLDER_LINK_SORT_RANK[getFolderLinkState(bId, linkedIds, unlinkedIds)];

/** True when badge sets are present and at least one known link/unlinked id exists. */
export const shouldShowFolderLinkStatus = (linkedIds?: Set<string> | null, unlinkedIds?: Set<string> | null): boolean =>
    Boolean(linkedIds?.size || unlinkedIds?.size);

export const sortByFolderLinkState = <T>(
    items: T[],
    getId: (item: T) => string | null,
    linkedIds?: Set<string> | null,
    unlinkedIds?: Set<string> | null,
): T[] => {
    if (!shouldShowFolderLinkStatus(linkedIds, unlinkedIds)) {
        return items;
    }

    return [...items].sort((a, b) => compareByFolderLinkState(getId(a), getId(b), linkedIds, unlinkedIds));
};
