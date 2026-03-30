// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Icon, Intent, Position, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { useGetDeviceOperationListPerf } from '../hooks/useAPI';

const ReportLinkStatus = () => {
    const useGetDeviceOperationListPerfResult = useGetDeviceOperationListPerf();
    const canMatchOperations = useGetDeviceOperationListPerfResult.length > 0;

    // Compute icon and messaging
    const tooltipContent = canMatchOperations ? (
        'Data linked between memory and performance reports'
    ) : (
        <>
            Unable to link active memory and performance reports
            <br />
            Please select reports generated from the same run to see additional data across the visualizer
        </>
    );
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

export default ReportLinkStatus;
