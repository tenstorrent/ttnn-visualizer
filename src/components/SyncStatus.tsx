// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Icon, Intent, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useGetDeviceOperationListPerf } from '../hooks/useAPI';
import 'styles/components/SyncStatus.scss';

const SyncStatus = () => {
    const useGetDeviceOperationListPerfResult = useGetDeviceOperationListPerf();
    const canMatchOperations = useGetDeviceOperationListPerfResult.length > 0;

    // Compute icon and messaging
    const tooltipContent = canMatchOperations
        ? 'Device operation data matched between reports'
        : 'Selected memory and performance reports are likely not from the same run';
    const icon = canMatchOperations ? IconNames.TickCircle : IconNames.ISSUE;
    const intent = canMatchOperations ? Intent.SUCCESS : Intent.WARNING;
    const message = canMatchOperations ? 'Active reports linked' : 'Unable to link active reports';

    return (
        <Tooltip content={tooltipContent}>
            <div className='sync-status'>
                <Icon
                    icon={icon}
                    intent={intent}
                />
                <strong>{message}</strong>
            </div>
        </Tooltip>
    );
};

export default SyncStatus;
