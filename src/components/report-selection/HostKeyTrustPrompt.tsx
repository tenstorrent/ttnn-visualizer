// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from 'react';
import { AxiosError } from 'axios';
import { useQuery } from '@tanstack/react-query';
import { Button, ButtonVariant, Callout, Intent, Size } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { HostKeyIssue } from '../../definitions/HostKey';
import {
    HOST_KEY_CHANGED_TITLE,
    HOST_KEY_COPIED_LABEL,
    HOST_KEY_COPY_LABEL,
    HOST_KEY_FETCHING_MESSAGE,
    HOST_KEY_NO_OFFER_NOTICE,
    HOST_KEY_PROXIED_NOTICE,
    HOST_KEY_REVOKED_NOTICE,
    HOST_KEY_REVOKED_TITLE,
    HOST_KEY_STALE_NOTICE,
    HOST_KEY_TRUST_BUTTON_LABEL,
    HOST_KEY_TRUST_FAILED_MESSAGE,
    HOST_KEY_TRUST_IN_PROGRESS_LABEL,
    HOST_KEY_TRUST_ON_FIRST_USE_NOTICE,
    HOST_KEY_UNKNOWN_TITLE,
    getHostKeyTargetLabel,
} from '../../definitions/ConnectionDialog';
import { DEFAULT_SSH_PORT } from '../../definitions/RemoteConnection';
import { TEST_IDS } from '../../definitions/TestIds';
import { HostKeyOffer, HostKeyOfferResponse, HostKeyStatus } from '../../model/HostKey';
import copyToClipboard from '../../functions/copyToClipboard';
import getResponseError from '../../functions/getResponseError';
import getServerConfig from '../../functions/getServerConfig';
import 'styles/components/HostKeyTrustPrompt.scss';

interface HostKeyTrustPromptProps {
    hostKey: HostKeyStatus;
    /** Fetches the offered keys. Omitted ⇒ the prompt falls back to the terminal remedy. */
    onRequestOffer?: () => Promise<HostKeyOfferResponse | null>;
    /** Records the keys the user confirmed. Omitted ⇒ no trust button. */
    onTrust?: (fingerprints: readonly string[]) => Promise<void>;
    /** The form has moved on since this verdict, so the offer no longer describes it. */
    isStale?: boolean;
}

const COPIED_LABEL_DURATION_MS = 2000;

const HOST_KEY_OFFER_QUERY_KEY = 'host-key-offer';

/**
 * Long enough that re-running the connection test does not re-probe the host.
 *
 * `ConnectionTestResults` keys its rows on the message, so each run swaps the verdict for
 * a progress line and back, remounting this component — with no stale window every one of
 * those remounts spawned another outbound `ssh-keyscan`. Rotation between the fingerprint
 * being shown and Trust being pressed is caught by the endpoint's own re-scan, which
 * refuses rather than trusting a key the user never saw.
 */
const HOST_KEY_OFFER_STALE_TIME_MS = 30_000;

/** The target fields a label is built from, shared by a status line and an offer. */
type HostKeyTarget = Pick<HostKeyStatus, 'host' | 'port' | 'alias' | 'entryName'>;

/**
 * The `known_hosts` key worth naming alongside the host, or `null` when it adds nothing.
 *
 * Withheld for the `[host]:port` spelling because the port is already on the line beside
 * it, and naming it twice buries the case that matters — a `HostKeyAlias`, where the key
 * is recorded against a name the label would otherwise never mention.
 */
const getRecordedName = ({ host, port, alias, entryName }: HostKeyTarget): string | null => {
    if (!entryName || entryName === host || entryName === alias) {
        return null;
    }

    const portedEntryName = port === DEFAULT_SSH_PORT ? host : `[${host}]:${port}`;

    return entryName === portedEntryName ? null : entryName;
};

const getTargetLabel = (target: HostKeyTarget): string => {
    const { host, port, alias } = target;
    const scanTarget = `${host} (port ${port})`;

    // Naming both is the difference between the user recognising the host and wondering
    // which machine we mean: they typed an alias, and the key is fetched from the name
    // that resolved from it, so showing only one of the two always confuses somebody.
    const scanned = alias && alias !== host ? `${alias} → ${scanTarget}` : scanTarget;

    return getHostKeyTargetLabel(scanned, getRecordedName(target));
};

interface CopyableCommandProps {
    command: string;
    testId: string;
}

/** A command the user has to run, with a copy affordance that confirms in place. */
function CopyableCommand({ command, testId }: CopyableCommandProps) {
    const [hasCopied, setHasCopied] = useState(false);

    useEffect(() => {
        if (!hasCopied) {
            return undefined;
        }

        const timer = window.setTimeout(() => setHasCopied(false), COPIED_LABEL_DURATION_MS);

        return () => window.clearTimeout(timer);
    }, [hasCopied]);

    const handleCopy = async () => {
        setHasCopied(await copyToClipboard(command));
    };

    return (
        <div className='host-key-command'>
            <code>{command}</code>

            <Button
                data-testid={testId}
                icon={hasCopied ? IconNames.TICK : IconNames.DUPLICATE}
                text={hasCopied ? HOST_KEY_COPIED_LABEL : HOST_KEY_COPY_LABEL}
                onClick={handleCopy}
                variant={ButtonVariant.MINIMAL}
                size={Size.SMALL}
            />
        </div>
    );
}

/**
 * The remedy attached to a host-key failure: a fingerprint plus a decision for an unknown
 * host, and a warning with no action for one whose key changed or has been revoked.
 *
 * Renders nothing under `SERVER_MODE` — the paired endpoints are `@local_only`, and this
 * is the frontend half of that gate.
 */
function HostKeyTrustPrompt({ hostKey, onRequestOffer, onTrust, isStale = false }: HostKeyTrustPromptProps) {
    const isServerMode = !!getServerConfig()?.SERVER_MODE;
    const [isTrusting, setIsTrusting] = useState(false);
    const [trustError, setTrustError] = useState<string | null>(null);

    const canFetchOffer =
        !isServerMode && hostKey.issue === HostKeyIssue.UNKNOWN && !hostKey.isProxied && !!onRequestOffer;

    // Keyed on `entryName` rather than the raw host/port: it *is* the resolution outcome,
    // so two connections that resolve differently (an identity file suppresses
    // `~/.ssh/config`) get separate cache entries instead of sharing one wrong answer.
    const {
        data: cachedOffer,
        isFetching: isLoadingOffer,
        error: offerError,
    } = useQuery<HostKeyOfferResponse | null, AxiosError>({
        queryKey: [HOST_KEY_OFFER_QUERY_KEY, hostKey.host, hostKey.port, hostKey.entryName],
        queryFn: () => (onRequestOffer ? onRequestOffer() : Promise.resolve(null)),
        enabled: canFetchOffer,
        staleTime: HOST_KEY_OFFER_STALE_TIME_MS,
        // A key that failed to scan is retried by running the test again, not by three
        // more connections to a host that is probably down.
        retry: false,
    });

    // A disabled query still hands back whatever is cached for its key, so a verdict we
    // never fetched for must not read one: an offer cached as UNKNOWN would otherwise
    // override a later CHANGED verdict and put a Trust button on a key that changed.
    const offer = canFetchOffer ? cachedOffer : undefined;
    const offers: HostKeyOffer[] = offer?.offers ?? [];
    const error = trustError ?? (offerError ? getResponseError(offerError, HOST_KEY_NO_OFFER_NOTICE) : null);

    if (isServerMode) {
        return null;
    }

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

    // The offer is the later answer and may legitimately disagree: the key may have been
    // accepted in a terminal since the test ran, or found in a `known_hosts` file the
    // test's own resolution never reached. Preferring the earlier verdict would show
    // "not recognised" for a host that is now trusted, with no fingerprint to explain it.
    const effectiveIssue = offer ? offer.issue : hostKey.issue;
    // Named off the offer for the same reason as the commands below: when the test's own
    // resolution failed, its status was built from the form alone and carries no
    // `HostKeyAlias`, so its entry name is a guess while the offer's is the one the key
    // will actually be recorded under.
    const targetLabel = getTargetLabel(offer ?? hostKey);
    const knownHostsEntry = offer?.knownHostsEntry ?? hostKey.knownHostsEntry;
    const removalCommand = offer?.removalCommand ?? hostKey.removalCommand;
    const terminalCommand = offer?.terminalCommand ?? hostKey.terminalCommand;

    // `null` is the offer endpoint's "already trusted": the key is recorded and matches,
    // so whatever the test failed on was not the host key and this block has no remedy to
    // offer. Falling through would title it "not recognised" *and* claim no key could be
    // fetched — two wrong answers about a host that is fine.
    if (offer && !effectiveIssue) {
        return null;
    }

    // Ahead of the changed-key branch and without its `ssh-keygen -R`: a revoked key is
    // not one the user can re-accept, and that command would delete the revocation
    // protecting them rather than resolve anything.
    if (effectiveIssue === HostKeyIssue.REVOKED) {
        return (
            <Callout
                className='host-key-prompt'
                data-testid={TEST_IDS.HOST_KEY_PROMPT}
                intent={Intent.DANGER}
                icon={IconNames.BAN_CIRCLE}
                title={HOST_KEY_REVOKED_TITLE}
            >
                <p>{targetLabel}</p>

                <p>{HOST_KEY_REVOKED_NOTICE}</p>

                {knownHostsEntry && <p className='host-key-entry'>{knownHostsEntry}</p>}
            </Callout>
        );
    }

    if (effectiveIssue === HostKeyIssue.CHANGED) {
        return (
            <Callout
                className='host-key-prompt'
                data-testid={TEST_IDS.HOST_KEY_PROMPT}
                intent={Intent.DANGER}
                icon={IconNames.WARNING_SIGN}
                title={HOST_KEY_CHANGED_TITLE}
            >
                <p>{targetLabel}</p>

                {knownHostsEntry && <p className='host-key-entry'>{knownHostsEntry}</p>}

                {removalCommand && (
                    <CopyableCommand
                        command={removalCommand}
                        testId={TEST_IDS.HOST_KEY_COPY_COMMAND}
                    />
                )}
            </Callout>
        );
    }

    // No key to show, so the terminal is the only remedy left — a jump host that cannot
    // be scanned, a scan that came back empty, or a dialog with no trust affordance
    // wired in. Saying nothing here is what left the MLIR dialog with an empty callout
    // next to a message telling the user to review a fingerprint.
    const hasNoOffer = !isLoadingOffer && offers.length === 0;
    const shouldFallBackToTerminal = hostKey.isProxied || !onRequestOffer || !!offer?.scanFailed || hasNoOffer;

    return (
        <Callout
            className='host-key-prompt'
            data-testid={TEST_IDS.HOST_KEY_PROMPT}
            intent={Intent.WARNING}
            icon={IconNames.WARNING_SIGN}
            title={HOST_KEY_UNKNOWN_TITLE}
        >
            <p>{targetLabel}</p>

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

            {shouldFallBackToTerminal && terminalCommand && (
                <>
                    {!hostKey.isProxied && <p>{HOST_KEY_NO_OFFER_NOTICE}</p>}

                    <CopyableCommand
                        command={terminalCommand}
                        testId={TEST_IDS.HOST_KEY_COPY_COMMAND}
                    />
                </>
            )}

            {error && (
                <p
                    className='host-key-error'
                    role='alert'
                >
                    {error}
                </p>
            )}

            {/* Withheld once the form has moved on: the fingerprints on screen were
                fetched for the target the test failed on, and trusting would post the
                one now in the form. */}
            {isStale && offers.length > 0 && <p className='host-key-notice'>{HOST_KEY_STALE_NOTICE}</p>}

            {onTrust && offers.length > 0 && !isStale && (
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
