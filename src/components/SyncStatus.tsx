// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Icon, Intent, Position, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { useGetDeviceOperationListPerf } from '../hooks/useAPI';

const SyncStatus = () => {
    const useGetDeviceOperationListPerfResult = useGetDeviceOperationListPerf();
    const canMatchOperations = useGetDeviceOperationListPerfResult.length > 0;

    // Compute icon and messaging
    const tooltipContent = canMatchOperations
        ? 'Device operation data matched between reports'
        : 'Selected memory and performance reports are likely not from the same run';
    const icon = canMatchOperations ? IconNames.LINK : IconNames.UNLINK;
    const intent = canMatchOperations ? Intent.SUCCESS : Intent.NONE;

    return (
        <Tooltip
            content={tooltipContent}
            position={Position.TOP}
        >
            <Icon
                className={classNames({ 'no-sync-status-icon': !canMatchOperations })}
                icon={icon}
                intent={intent}
            />
        </Tooltip>
    );
};

export default SyncStatus;
