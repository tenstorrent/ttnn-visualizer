// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { HostKeyIssue } from '../definitions/HostKey';

/** One host key the server offered, from POST /api/remote/host-key. */
export interface HostKeyOffer {
    keyType: string;
    fingerprint: string;
    /** The `known_hosts` line as scanned. Opaque to the UI; echoed back on trust. */
    line: string;
}

/**
 * Why a connection test failed on the host key, and against which target.
 *
 * `host` is the name `known_hosts` keys the entry on, which is not necessarily what the
 * user typed: an `~/.ssh/config` alias resolves through `HostName` and `Port`, so `alias`
 * carries the typed name whenever the two differ.
 */
export interface HostKeyStatus {
    issue: HostKeyIssue;
    host: string;
    port: number;
    alias?: string | null;
    isProxied?: boolean;
    /** What `known_hosts` keys the entry on — the `HostKeyAlias` when one is set. */
    entryName?: string;
    /**
     * `ssh-keygen -R` for this target, ready to copy.
     *
     * Backend-supplied rather than rebuilt here: it was once derived in both places from
     * different halves of the resolution, and both copies rendered at once — two
     * different commands for one failure.
     */
    removalCommand?: string;
    /** The `ssh` command that lets OpenSSH prompt for the key itself. */
    terminalCommand?: string;
    /** `"<file>:<line>"` of the entry to remove, for a key that changed. */
    knownHostsEntry?: string | null;
}

/**
 * Response shape for POST /api/remote/host-key.
 *
 * Extends the status because the offer may legitimately *disagree* with the verdict the
 * connection test gave — a key accepted in a terminal since, or an entry found in a file
 * the test's resolution did not reach — and the later answer is the truer one.
 *
 * `issue` is null when the host is already trusted, meaning the failure the caller saw
 * was about something else.
 */
export interface HostKeyOfferResponse extends Omit<HostKeyStatus, 'issue'> {
    issue?: HostKeyIssue | null;
    /** The scan produced nothing, so no judgement about the key was possible. */
    scanFailed?: boolean;
    offers: HostKeyOffer[];
}

/**
 * True when a status line carries a host-key verdict the prompt can render.
 *
 * Shape-checked rather than trusted because this decides whether a trust affordance is
 * offered at all — a malformed payload must render nothing rather than a button pointing
 * at an undefined host.
 */
export const isHostKeyStatus = (value: unknown): value is HostKeyStatus => {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as HostKeyStatus;

    return (
        Object.values(HostKeyIssue).includes(candidate.issue) &&
        typeof candidate.host === 'string' &&
        typeof candidate.port === 'number'
    );
};

/** True when an offer carries both fields the user needs to make the comparison. */
export const isHostKeyOffer = (value: unknown): value is HostKeyOffer =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as HostKeyOffer).keyType === 'string' &&
    typeof (value as HostKeyOffer).fingerprint === 'string' &&
    typeof (value as HostKeyOffer).line === 'string';
