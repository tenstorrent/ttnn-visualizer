// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { ConnectionStatus, ConnectionTestStates } from '../definitions/ConnectionStatus';
import { RemoteConnection } from '../model/RemoteConnection';

const FAILED_NO_CONNECTION: ConnectionStatus = {
    status: ConnectionTestStates.FAILED,
    message: 'No connection provided',
};
const FAILED_NO_PATH: ConnectionStatus = {
    status: ConnectionTestStates.FAILED,
    message: 'Please provide at least one folder path.',
};

/**
 * The failure a connection test reports without asking the server, or `null` when it would
 * be sent. Shared so a caller can tell a form error from a test that actually ran.
 */
export default function getConnectionTestPrecheckFailure(
    connection: Partial<RemoteConnection>,
): ConnectionStatus | null {
    if (!connection.host || !connection.port) {
        return FAILED_NO_CONNECTION;
    }

    if (!connection.profilerPath && !connection.performancePath) {
        return FAILED_NO_PATH;
    }

    return null;
}
