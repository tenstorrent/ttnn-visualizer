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
