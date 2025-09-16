// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Icon, Intent } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import { ConnectionStatus, ConnectionTestStates } from '../../definitions/ConnectionStatus';

type ConnectionTestMessageProps = ConnectionStatus;

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

function ConnectionTestMessage({ status, message, detail }: ConnectionTestMessageProps) {
    return (
        <div className={`verify-connection-item status-${ConnectionTestStates[status].toLowerCase()}`}>
            <Icon
                className='connection-status-icon'
                icon={ICON_MAP[status]}
                size={20}
                intent={INTENT_MAP[status]}
            />
            <div className='connection-status-content'>
                <span className='connection-status-text'>{message}</span>
                {detail && <code className='connection-status-detail'>{detail}</code>}
            </div>
        </div>
    );
}

export default ConnectionTestMessage;
