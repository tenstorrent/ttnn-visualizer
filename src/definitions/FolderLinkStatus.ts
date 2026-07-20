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
