import { Icon } from '@blueprintjs/core';
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
                        className='intent-ok'
                    />{' '}
                    Profiler and perf reports synchronised
                </strong>
            ) : (
                <strong>
                    <Icon
                        icon={IconNames.ISSUE}
                        className='intent-not-ok'
                    />{' '}
                    Profiler and perf reports can&apos;t be synchronized
                </strong>
            )}
        </span>
    );
};

export default SyncStatus;
