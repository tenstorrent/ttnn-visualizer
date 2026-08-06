// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { RemoteConnection } from '../definitions/RemoteConnection';

/**
 * Connection identity as the app has always treated it: name, host and port. Paths and the
 * identity file are editable properties of a connection, not part of which connection it is.
 *
 * Both parameters are optional *and* nullable because callers pass a mix — `undefined` from the
 * optional `connection` prop and the `selectedConnection` getter, `null` from dropdown row state.
 */
export const isSameConnection = (a?: RemoteConnection | null, b?: RemoteConnection | null): boolean =>
    !!a && !!b && a.name === b.name && a.host === b.host && a.port === b.port;

/**
 * Identity as a string, over exactly the fields `isSameConnection` compares. Everything that keys
 * data by connection — React list keys, cached folder lists in localStorage — must use this, or
 * two connections that differ only by host end up sharing a key while counting as distinct, and
 * deleting one silently discards the other's data.
 */
export const remoteConnectionKey = (connection?: RemoteConnection | null): string =>
    connection ? `${connection.name}|${connection.host}|${connection.port}` : '';

/** Two names that differ only in case or surrounding space read as the same name to a user. */
const normaliseConnectionName = (name: string): string => name.trim().toLowerCase();

/**
 * Whether `name` already belongs to another saved connection. The name is all a user has to tell
 * connections apart in the picker, so a second one carrying it makes both ambiguous — and because
 * identity includes the name, a duplicate also makes the two harder to keep straight in storage.
 *
 * `connectionBeingEdited` is excluded by identity rather than by name: an edit that keeps the name
 * and changes the host would otherwise find the entry it is about to replace and report itself.
 */
export const isConnectionNameTaken = (
    name: string,
    connections: readonly RemoteConnection[],
    connectionBeingEdited?: RemoteConnection,
): boolean => {
    const candidate = normaliseConnectionName(name);

    return connections.some(
        (connection) =>
            !isSameConnection(connection, connectionBeingEdited) &&
            normaliseConnectionName(connection.name) === candidate,
    );
};
