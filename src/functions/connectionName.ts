// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
    ConnectionNameSubject,
    getNameAvailableMessage,
    getNameRequiredMessage,
    getNameTakenMessage,
} from '../definitions/ConnectionDialog';
import { ConnectionStatus, ConnectionTestStates } from '../definitions/ConnectionStatus';

/** Anything a connection dialog lets a user name and save. */
interface NamedTarget {
    name: string;
}

/** Two names that differ only in case or surrounding space read as the same name to a user. */
const normaliseConnectionName = (name: string): string => name.trim().toLowerCase();

/**
 * Whether `name` already belongs to another saved target. The name is all a user has to tell
 * saved targets apart in the picker, so a second one carrying it makes both ambiguous — and
 * because identity includes the name, a duplicate also makes the two harder to keep straight
 * in storage.
 *
 * `targetBeingEdited` is excluded by identity rather than by name: an edit that keeps the name
 * and changes the host would otherwise find the entry it is about to replace and report itself.
 * Identity stays the caller's to define, since remote connections and MLIR servers are the same
 * name check over different fields.
 */
export const isConnectionNameTaken = <T extends NamedTarget>(
    name: string,
    targets: readonly T[],
    isSameTarget: (a?: T | null, b?: T | null) => boolean,
    targetBeingEdited?: T,
): boolean => {
    const candidate = normaliseConnectionName(name);

    return targets.some(
        (target) => !isSameTarget(target, targetBeingEdited) && normaliseConnectionName(target.name) === candidate,
    );
};

/** The line the name earns among the connection test results. */
export const getConnectionNameStatus = (
    name: string,
    isNameTaken: boolean,
    subject: ConnectionNameSubject,
): ConnectionStatus => {
    if (!name.trim()) {
        return { status: ConnectionTestStates.FAILED, message: getNameRequiredMessage(subject) };
    }

    if (isNameTaken) {
        return { status: ConnectionTestStates.FAILED, message: getNameTakenMessage(subject, name.trim()) };
    }

    return { status: ConnectionTestStates.OK, message: getNameAvailableMessage(subject) };
};
