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
    /** `"<file>:<line>"` of the entry to remove, for a key that changed. */
    knownHostsEntry?: string | null;
}

/** Response shape for POST /api/remote/host-key. `issue` is null when already trusted. */
export interface HostKeyOfferResponse {
    issue?: HostKeyIssue | null;
    host: string;
    port: number;
    alias?: string | null;
    isProxied?: boolean;
    knownHostsEntry?: string | null;
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
