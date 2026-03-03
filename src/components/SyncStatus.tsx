// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Icon, Intent, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useGetDeviceOperationListPerf } from '../hooks/useAPI';

const SyncStatus = () => {
    const useGetDeviceOperationListPerfResult = useGetDeviceOperationListPerf();
    const isInSync = useGetDeviceOperationListPerfResult.length > 0;

    return (
        <span>
            {isInSync ? (
                <Tooltip content='Reports synchronized - data is enriched'>
                    <strong>
                        <Icon
                            icon={IconNames.TickCircle}
                            intent={Intent.SUCCESS}
                        />{' '}
                        Profiler and perf reports synchronised
                    </strong>
                </Tooltip>
            ) : (
                <Tooltip content='Unable to match operations in the profiler report with those in the performance report, please check both reports are from the same run'>
                    <strong>
                        <Icon
                            icon={IconNames.ISSUE}
                            intent={Intent.WARNING}
                        />{' '}
                        {`Profiler and perf reports can't be synchronized`}
                    </strong>
                </Tooltip>
            )}
        </span>
    );
};

export default SyncStatus;
