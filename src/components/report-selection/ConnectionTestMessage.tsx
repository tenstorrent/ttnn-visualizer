// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Icon, Intent } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import { ConnectionStatus, ConnectionTestStates } from '../../definitions/ConnectionStatus';
import { HostKeyOfferResponse, isHostKeyStatus } from '../../model/HostKey';
import HostKeyTrustPrompt from './HostKeyTrustPrompt';
import 'styles/components/ConnectionTestMessage.scss';

interface ConnectionTestMessageProps extends ConnectionStatus {
    /** Fetches the offered keys for a host-key failure. Omitted ⇒ read-only prompt. */
    onRequestHostKeyOffer?: () => Promise<HostKeyOfferResponse | null>;
    /** Records the keys the user confirmed. Omitted ⇒ no trust button. */
    onTrustHost?: (fingerprints: readonly string[]) => Promise<void>;
}

const ICON_MAP: Record<ConnectionTestStates, IconName> = {
    [ConnectionTestStates.IDLE]: IconNames.DOT,
    [ConnectionTestStates.PROGRESS]: IconNames.DOT,
    [ConnectionTestStates.FAILED]: IconNames.CROSS,
    [ConnectionTestStates.OK]: IconNames.TICK,
    [ConnectionTestStates.WARNING]: IconNames.WARNING_SIGN,
};

const INTENT_MAP: Record<ConnectionTestStates, Intent> = {
    [ConnectionTestStates.IDLE]: Intent.NONE,
    [ConnectionTestStates.PROGRESS]: Intent.WARNING,
    [ConnectionTestStates.FAILED]: Intent.DANGER,
    [ConnectionTestStates.OK]: Intent.SUCCESS,
    [ConnectionTestStates.WARNING]: Intent.WARNING,
};

function ConnectionTestMessage({
    status,
    message,
    detail,
    hostKey,
    onRequestHostKeyOffer,
    onTrustHost,
}: ConnectionTestMessageProps) {
    return (
        <div className={`connection-test-message status-${ConnectionTestStates[status].toLowerCase()}`}>
            <Icon
                className='connection-status-icon'
                icon={ICON_MAP[status]}
                size={18}
                intent={INTENT_MAP[status]}
            />

            <div className='connection-status-content'>
                <span className='connection-status-text'>{message}</span>
                {detail && <code className='connection-status-detail'>{detail}</code>}

                {/* Shape-checked rather than truthiness-checked: this decides whether a
                    trust affordance appears at all, so a malformed payload renders
                    nothing rather than a button pointing at an undefined host. */}
                {isHostKeyStatus(hostKey) && (
                    <HostKeyTrustPrompt
                        hostKey={hostKey}
                        onRequestOffer={onRequestHostKeyOffer}
                        onTrust={onTrustHost}
                    />
                )}
            </div>
        </div>
    );
}

export default ConnectionTestMessage;
