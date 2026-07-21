// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Icon, Intent, Position, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { FolderLinkState } from '../../definitions/FolderLinkStatus';

const FOLDER_LINK_STATUS = {
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

interface FolderLinkStatusIconProps {
    linkState: FolderLinkState;
}

const FolderLinkStatusIcon = ({ linkState }: FolderLinkStatusIconProps) => {
    const linkStatus = FOLDER_LINK_STATUS[linkState];

    return (
        <Tooltip
            content={linkStatus.tooltip}
            position={Position.RIGHT}
        >
            <Icon
                className={linkState === FolderLinkState.UNKNOWN ? 'folder-link-status-unknown' : undefined}
                icon={linkStatus.icon}
                intent={linkStatus.intent}
            />
        </Tooltip>
    );
};

export default FolderLinkStatusIcon;
