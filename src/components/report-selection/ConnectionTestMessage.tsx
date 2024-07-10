import { IconName, IconNames } from '@blueprintjs/icons';
import { Icon, Intent } from '@blueprintjs/core';
import { ConnectionTestStates } from '../../hooks/useRemote';

interface ConnectionTestMessageProps {
    status: ConnectionTestStates;
    message: string;
}

function ConnectionTestMessage({ status, message }: ConnectionTestMessageProps) {
    const iconMap: Record<ConnectionTestStates, IconName> = {
        [ConnectionTestStates.IDLE]: IconNames.DOT,
        [ConnectionTestStates.PROGRESS]: IconNames.DOT,
        [ConnectionTestStates.FAILED]: IconNames.CROSS,
        [ConnectionTestStates.OK]: IconNames.TICK,
    };

    const statusMap: Record<ConnectionTestStates, Intent> = {
        [ConnectionTestStates.IDLE]: Intent.NONE,
        [ConnectionTestStates.PROGRESS]: Intent.WARNING,
        [ConnectionTestStates.FAILED]: Intent.DANGER,
        [ConnectionTestStates.OK]: Intent.SUCCESS,
    };

    return (
        <div className={`verify-connection-item status-${ConnectionTestStates[status]}`}>
            <Icon
                className='connection-status-icon'
                icon={iconMap[status]}
                size={20}
                intent={statusMap[status]}
            />
            <span className='connection-status-text'>{message}</span>
        </div>
    );
}

export default ConnectionTestMessage;
