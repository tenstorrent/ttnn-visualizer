// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from 'react';
import { AxiosError } from 'axios';
import { useQuery } from '@tanstack/react-query';
import { Button, Callout, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { HostKeyIssue } from '../../definitions/HostKey';
import {
    HOST_KEY_CHANGED_TITLE,
    HOST_KEY_FETCHING_MESSAGE,
    HOST_KEY_NO_OFFER_NOTICE,
    HOST_KEY_PROXIED_NOTICE,
    HOST_KEY_TRUST_BUTTON_LABEL,
    HOST_KEY_TRUST_FAILED_MESSAGE,
    HOST_KEY_TRUST_IN_PROGRESS_LABEL,
    HOST_KEY_TRUST_ON_FIRST_USE_NOTICE,
    HOST_KEY_UNKNOWN_TITLE,
} from '../../definitions/ConnectionDialog';
import { TEST_IDS } from '../../definitions/TestIds';
import { HostKeyOffer, HostKeyOfferResponse, HostKeyStatus } from '../../model/HostKey';
import copyToClipboard from '../../functions/copyToClipboard';
import getResponseError from '../../functions/getResponseError';
import getServerConfig from '../../functions/getServerConfig';
import 'styles/components/HostKeyTrustPrompt.scss';

interface HostKeyTrustPromptProps {
    hostKey: HostKeyStatus;
    /** Fetches the offered keys. Omitted ⇒ the prompt explains but offers no action. */
    onRequestOffer?: () => Promise<HostKeyOfferResponse | null>;
    /** Records the keys the user confirmed. Omitted ⇒ no trust button. */
    onTrust?: (fingerprints: readonly string[]) => Promise<void>;
}

const COPIED_LABEL_DURATION_MS = 2000;

const HOST_KEY_OFFER_QUERY_KEY = 'host-key-offer';

/** `ssh-keygen -R` for a target, in the form `known_hosts` keys entries by. */
const getRemovalCommand = ({ host, port }: HostKeyStatus): string =>
    port === 22 ? `ssh-keygen -R ${host}` : `ssh-keygen -R '[${host}]:${port}'`;

const getTargetLabel = ({ host, port, alias }: HostKeyStatus): string => {
    const target = `${host} (port ${port})`;

    // Naming both is the difference between the user recognising the host and wondering
    // which machine we mean: they typed an alias, and `known_hosts` records the resolved
    // name, so showing only one of the two always confuses somebody.
    return alias && alias !== host ? `${alias} → ${target}` : target;
};

/**
 * The remedy attached to a host-key failure: a fingerprint plus a decision for an unknown
 * host, and a warning with no action for one whose key changed.
 *
 * Renders nothing under `SERVER_MODE` — the paired endpoints are `@local_only`, and this
 * is the frontend half of that gate.
 */
function HostKeyTrustPrompt({ hostKey, onRequestOffer, onTrust }: HostKeyTrustPromptProps) {
    const isServerMode = !!getServerConfig()?.SERVER_MODE;
    const [isTrusting, setIsTrusting] = useState(false);
    const [trustError, setTrustError] = useState<string | null>(null);
    const [hasCopied, setHasCopied] = useState(false);

    const isUnknownKey = hostKey.issue === HostKeyIssue.UNKNOWN;
    const canFetchOffer = !isServerMode && isUnknownKey && !hostKey.isProxied && !!onRequestOffer;

    // Keyed on the target, not on the callback the dialog rebuilds each render, so typing
    // in the form cannot set off a fresh scan of the host.
    const {
        data: offer,
        isFetching: isLoadingOffer,
        error: offerError,
    } = useQuery<HostKeyOfferResponse | null, AxiosError>({
        queryKey: [HOST_KEY_OFFER_QUERY_KEY, hostKey.host, hostKey.port],
        queryFn: () => (onRequestOffer ? onRequestOffer() : Promise.resolve(null)),
        enabled: canFetchOffer,
        // Not report-bound, and a key that failed to scan should be retried by the user
        // pressing the button again rather than by three more connections to the host.
        staleTime: 0,
        retry: false,
    });

    const offers: HostKeyOffer[] = offer?.offers ?? [];
    const error = trustError ?? (offerError ? getResponseError(offerError, HOST_KEY_NO_OFFER_NOTICE) : null);

    useEffect(() => {
        if (!hasCopied) {
            return undefined;
        }

        const timer = window.setTimeout(() => setHasCopied(false), COPIED_LABEL_DURATION_MS);

        return () => window.clearTimeout(timer);
    }, [hasCopied]);

    if (isServerMode) {
        return null;
    }

    const handleCopyRemovalCommand = async () => {
        setHasCopied(await copyToClipboard(getRemovalCommand(hostKey)));
    };

    const handleTrust = async () => {
        if (!onTrust) {
            return;
        }

        setIsTrusting(true);
        setTrustError(null);

        try {
            await onTrust(offers.map(({ fingerprint }) => fingerprint));
        } catch (err) {
            setTrustError(getResponseError(err, HOST_KEY_TRUST_FAILED_MESSAGE));
        } finally {
            setIsTrusting(false);
        }
    };

    if (!isUnknownKey) {
        return (
            <Callout
                className='host-key-prompt'
                data-testid={TEST_IDS.HOST_KEY_PROMPT}
                intent={Intent.DANGER}
                icon={IconNames.WARNING_SIGN}
                title={HOST_KEY_CHANGED_TITLE}
            >
                <p>{getTargetLabel(hostKey)}</p>

                {hostKey.knownHostsEntry && <p className='host-key-entry'>{hostKey.knownHostsEntry}</p>}

                <div className='host-key-command'>
                    <code>{getRemovalCommand(hostKey)}</code>

                    <Button
                        data-testid={TEST_IDS.HOST_KEY_COPY_COMMAND}
                        icon={hasCopied ? IconNames.TICK : IconNames.DUPLICATE}
                        text={hasCopied ? 'Copied' : 'Copy'}
                        onClick={handleCopyRemovalCommand}
                        variant='minimal'
                        size='small'
                    />
                </div>
            </Callout>
        );
    }

    return (
        <Callout
            className='host-key-prompt'
            data-testid={TEST_IDS.HOST_KEY_PROMPT}
            intent={Intent.WARNING}
            icon={IconNames.WARNING_SIGN}
            title={HOST_KEY_UNKNOWN_TITLE}
        >
            <p>{getTargetLabel(hostKey)}</p>

            {hostKey.isProxied && <p>{HOST_KEY_PROXIED_NOTICE}</p>}

            {isLoadingOffer && <p>{HOST_KEY_FETCHING_MESSAGE}</p>}

            {offers.length > 0 && (
                <>
                    <ul className='host-key-offers'>
                        {offers.map(({ keyType, fingerprint }) => (
                            <li
                                key={fingerprint}
                                data-testid={TEST_IDS.HOST_KEY_FINGERPRINT}
                            >
                                <span className='host-key-type'>{keyType}</span>
                                <code className='host-key-fingerprint'>{fingerprint}</code>
                            </li>
                        ))}
                    </ul>

                    <p className='host-key-notice'>{HOST_KEY_TRUST_ON_FIRST_USE_NOTICE}</p>
                </>
            )}

            {error && <p className='host-key-error'>{error}</p>}

            {onTrust && offers.length > 0 && (
                <Button
                    data-testid={TEST_IDS.HOST_KEY_TRUST_BUTTON}
                    text={isTrusting ? HOST_KEY_TRUST_IN_PROGRESS_LABEL : HOST_KEY_TRUST_BUTTON_LABEL}
                    icon={IconNames.CONFIRM}
                    intent={Intent.SUCCESS}
                    onClick={handleTrust}
                    disabled={isTrusting}
                    loading={isTrusting}
                />
            )}
        </Callout>
    );
}

export default HostKeyTrustPrompt;
