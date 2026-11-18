// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { ConnectionStatus, ConnectionTestStates } from '../definitions/ConnectionStatus';
import { RemoteConnection } from '../model/RemoteConnection';

export const FAILED_NO_CONNECTION: ConnectionStatus = {
    status: ConnectionTestStates.FAILED,
    message: 'No connection provided',
};
export const FAILED_NO_USERNAME: ConnectionStatus = {
    status: ConnectionTestStates.FAILED,
    message: 'Please provide a username.',
};
export const FAILED_NO_PATH: ConnectionStatus = {
    status: ConnectionTestStates.FAILED,
    message: 'Please provide at least one folder path.',
};

// Every result the precheck can give, in one place for the reference check below.
const PRECHECK_FAILURES: readonly ConnectionStatus[] = [FAILED_NO_CONNECTION, FAILED_NO_USERNAME, FAILED_NO_PATH];

/**
 * The failure a connection test reports without asking the server, or `null` when it would
 * be sent. `testConnection` is the one caller that gates on it.
 */
export default function getConnectionTestPrecheckFailure(
    connection: Partial<RemoteConnection>,
): ConnectionStatus | null {
    if (!connection.host || !connection.port) {
        return FAILED_NO_CONNECTION;
    }

    // The server refuses an empty username too, but only after the request is sent.
    if (!connection.username?.trim()) {
        return FAILED_NO_USERNAME;
    }

    // Trimmed like the username: a path of only spaces names no folder, and the server would
    // search none.
    if (!connection.profilerPath?.trim() && !connection.performancePath?.trim()) {
        return FAILED_NO_PATH;
    }

    return null;
}

/**
 * Whether a connection test's result is a form error `testConnection` answered without
 * sending. By reference, so a server line that happens to share a message never matches.
 */
export function isConnectionTestPrecheckFailure(statuses: readonly ConnectionStatus[]): boolean {
    return statuses.length === 1 && PRECHECK_FAILURES.includes(statuses[0]);
}
