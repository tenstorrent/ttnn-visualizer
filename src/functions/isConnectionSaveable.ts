// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { ConnectionStatus, ConnectionTestStates } from '../definitions/ConnectionStatus';

/**
 * Whether a connection dialog may save what its form currently holds.
 *
 * Both dialogs gate on the same two things — a name nothing else has taken, and a run whose
 * results still describe the target in the form — so one of them tightening the gate on its own
 * would be a difference the user has no way to explain. A WARNING passes deliberately: the server
 * reports a configured path holding no reports that way, and a host whose reports haven't been
 * generated yet is exactly what someone is setting the connection up to collect.
 */
const isConnectionSaveable = (
    nameStatus: ConnectionStatus,
    tests: readonly ConnectionStatus[],
    isStale: boolean,
): boolean =>
    nameStatus.status === ConnectionTestStates.OK &&
    !isStale &&
    tests.length > 0 &&
    tests.every(({ status }) => status === ConnectionTestStates.OK || status === ConnectionTestStates.WARNING);

export default isConnectionSaveable;
