// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Icon, Position, Tooltip } from '@blueprintjs/core';
import { FOLDER_LINK_STATUS, FolderLinkState } from '../../definitions/FolderLinkStatus';

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
