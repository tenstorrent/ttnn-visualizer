// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/** Copy shared by the remote connection and MLIR server dialogs, which behave alike. */

/** Legend of the results block — the accessible name both dialogs' tests address it by. */
export const CONNECTION_TEST_LEGEND = 'Test Connection';

/** Marks results that describe a target the form has since moved away from. */
export const STALE_CONNECTION_TESTS_CLASS = 'stale-connection-tests';

/** Both halves of the save gate, since either one alone can be what's blocking it. */
export const SAVE_BLOCKED_TOOLTIP = 'Enter a unique name and pass the connection tests before saving';

/** Heading of the block offering to record a host's key. */
export const HOST_KEY_UNKNOWN_TITLE = 'Host key not recognised';

/** Heading of the block refusing to, because the recorded key no longer matches. */
export const HOST_KEY_CHANGED_TITLE = 'Host key has changed';

/**
 * Says plainly what accepting buys and what it does not.
 *
 * The key is fetched over the same unauthenticated path as the connection, so trusting it
 * proves nothing about the host. What makes the decision meaningful is that the user makes
 * it with the fingerprint in front of them, and the copy has to say so rather than imply
 * the app checked something.
 */
export const HOST_KEY_TRUST_ON_FIRST_USE_NOTICE =
    'This key was fetched over the same unverified connection, so it cannot confirm the host is genuine. ' +
    'Compare the fingerprint against one you obtained another way before trusting it.';

export const HOST_KEY_FETCHING_MESSAGE = 'Fetching the host key…';

export const HOST_KEY_TRUST_BUTTON_LABEL = 'Trust this host';

export const HOST_KEY_TRUST_FAILED_MESSAGE = 'The host key could not be trusted.';

export const HOST_KEY_TRUST_IN_PROGRESS_LABEL = 'Trusting…';

/** Shown when the host is reached through a jump host, which cannot be scanned. */
export const HOST_KEY_PROXIED_NOTICE =
    'This host is reached through a jump host, so its key cannot be fetched directly. ' +
    'Connect once in a terminal and accept the key there.';

/** Shown when the scan came back with nothing, so there is no fingerprint to show. */
export const HOST_KEY_NO_OFFER_NOTICE = 'No host key could be fetched. Check the host and port, then try again.';

/** The noun a dialog uses for what it saves, as it reads at the start of a sentence. */
export enum ConnectionNameSubject {
    CONNECTION = 'Connection',
    SERVER = 'Server',
}

/** Accessible name of the name field, derived from the same noun as the messages about it. */
export const getNameFieldLabel = (subject: ConnectionNameSubject) => `${subject} Name`;

/** A target saved without a name is discarded as invalid the next time the list is read. */
export const getNameRequiredMessage = (subject: ConnectionNameSubject) => `${subject} name is required`;

export const getNameTakenMessage = (subject: ConnectionNameSubject, name: string) =>
    `A ${subject.toLowerCase()} named "${name}" already exists`;

export const getNameAvailableMessage = (subject: ConnectionNameSubject) => `${subject} name is available`;
