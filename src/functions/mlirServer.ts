// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { MlirServerConnection } from '../model/MlirServer';

/** Stable React list key from connection fields (not display formatting). */
export const mlirServerKey = (server: MlirServerConnection): string =>
    `${server.host}|${server.sshPort}|${server.username}|${server.port}|${server.name}|${server.identityFile ?? ''}`;

export const isSameMlirServer = (a?: MlirServerConnection | null, b?: MlirServerConnection | null): boolean =>
    !!a &&
    !!b &&
    a.name === b.name &&
    a.username === b.username &&
    a.host === b.host &&
    a.sshPort === b.sshPort &&
    a.port === b.port &&
    (a.identityFile ?? '') === (b.identityFile ?? '');

/** Same resolution as the MLIR server picker: selected match, else first listed. */
export const getActiveMlirServer = (
    servers: MlirServerConnection[],
    selected: MlirServerConnection | null,
): MlirServerConnection | null => servers.find((server) => isSameMlirServer(server, selected)) ?? servers[0] ?? null;
