// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Icon, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useGetDeviceOperationListPerf } from '../hooks/useAPI';

const SyncStatus = () => {
    const useGetDeviceOperationListPerfResult = useGetDeviceOperationListPerf();
    const isInSync = useGetDeviceOperationListPerfResult.length > 0;

    return (
        <span>
            {isInSync ? (
                <strong>
                    <Icon
                        icon={IconNames.TickCircle}
                        intent={Intent.SUCCESS}
                    />{' '}
                    Profiler and perf reports synchronised
                </strong>
            ) : (
                <strong>
                    <Icon
                        icon={IconNames.ISSUE}
                        intent={Intent.DANGER}
                    />{' '}
                    Profiler and perf reports can&apos;t be synchronized
                </strong>
            )}
        </span>
    );
};

export default SyncStatus;
