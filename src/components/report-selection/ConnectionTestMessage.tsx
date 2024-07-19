// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { IconName, IconNames } from '@blueprintjs/icons';
import { Icon, Intent } from '@blueprintjs/core';
import { ConnectionTestStates } from '../../model/Connection';

interface ConnectionTestMessageProps {
    status: ConnectionTestStates;
    message: string;
}

const ICON_MAP: Record<ConnectionTestStates, IconName> = {
    [ConnectionTestStates.IDLE]: IconNames.DOT,
    [ConnectionTestStates.PROGRESS]: IconNames.DOT,
    [ConnectionTestStates.FAILED]: IconNames.CROSS,
    [ConnectionTestStates.OK]: IconNames.TICK,
};

const INTENT_MAP: Record<ConnectionTestStates, Intent> = {
    [ConnectionTestStates.IDLE]: Intent.NONE,
    [ConnectionTestStates.PROGRESS]: Intent.WARNING,
    [ConnectionTestStates.FAILED]: Intent.DANGER,
    [ConnectionTestStates.OK]: Intent.SUCCESS,
};

function ConnectionTestMessage({ status, message }: ConnectionTestMessageProps) {
    return (
        <div className={`verify-connection-item status-${ConnectionTestStates[status]}`}>
            <Icon
                className='connection-status-icon'
                icon={ICON_MAP[status]}
                size={20}
                intent={INTENT_MAP[status]}
            />
            <span className='connection-status-text'>{message}</span>
        </div>
    );
}

export default ConnectionTestMessage;
