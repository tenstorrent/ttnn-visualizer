// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { ConnectionNameSubject } from '../src/definitions/ConnectionDialog';
import { ConnectionTestStates } from '../src/definitions/ConnectionStatus';
import { MlirServerConnection } from '../src/model/MlirServer';
import { RemoteConnection } from '../src/model/RemoteConnection';
import { getConnectionNameStatus, isConnectionNameTaken } from '../src/functions/connectionName';
import { isSameMlirServer } from '../src/functions/mlirServer';
import { isSameConnection } from '../src/functions/remoteConnection';

const connection: RemoteConnection = {
    name: 'Worker',
    username: 'tt',
    host: 'worker-01',
    port: 2222,
    profilerPath: '/mem',
    performancePath: '/perf',
};

const connections = [connection, { ...connection, name: 'Spare', host: 'worker-02' }];

describe('isConnectionNameTaken', () => {
    it('reports a name already carried by a saved connection', () => {
        expect(isConnectionNameTaken('Worker', connections, isSameConnection)).toBe(true);
    });

    it('accepts a name no saved connection carries', () => {
        expect(isConnectionNameTaken('Worker 2', connections, isSameConnection)).toBe(false);
    });

    it.each([
        ['case', 'worker'],
        ['surrounding space', '  Worker  '],
    ])('treats a name differing only by %s as the same name', (_difference, name) => {
        expect(isConnectionNameTaken(name, connections, isSameConnection)).toBe(true);
    });

    it('accepts an edited connection keeping its own name', () => {
        expect(isConnectionNameTaken('Worker', connections, isSameConnection, connection)).toBe(false);
    });

    it('still rejects an edit that takes another connection name', () => {
        expect(isConnectionNameTaken('Spare', connections, isSameConnection, connection)).toBe(true);
    });

    it('excludes the edited connection by identity, not by name', () => {
        // Editing the host of a connection whose name is unchanged: the entry about to be
        // replaced is still in the list, and matching on name alone would find it.
        const movedHost = { ...connection, host: 'worker-99' };

        expect(isConnectionNameTaken(movedHost.name, connections, isSameConnection, connection)).toBe(false);
    });

    it('finds nothing in an empty list', () => {
        expect(isConnectionNameTaken('Worker', [], isSameConnection)).toBe(false);
    });
});

describe('isConnectionNameTaken over MLIR servers', () => {
    const server: MlirServerConnection = {
        name: 'Explorer',
        username: 'tt',
        host: 'aus-wh-05',
        sshPort: 22,
        port: 8080,
    };
    const servers = [server, { ...server, name: 'Spare', host: 'aus-wh-06' }];

    it('reports a name already carried by a saved server', () => {
        expect(isConnectionNameTaken('explorer', servers, isSameMlirServer)).toBe(true);
    });

    it('excludes the edited server by its own identity fields', () => {
        // The MLIR port is part of a server's identity and no part of a connection's, so
        // sharing the check only works while each side brings its own comparison.
        const movedPort = { ...server, port: 9090 };

        expect(isConnectionNameTaken(server.name, [...servers, movedPort], isSameMlirServer, movedPort)).toBe(true);
        expect(isConnectionNameTaken(server.name, [movedPort], isSameMlirServer, movedPort)).toBe(false);
    });
});

/**
 * Spelled out rather than built from the definitions' helpers, unlike the dialog specs: this is
 * where the copy itself is pinned, and asserting a builder against its own output would only
 * restate it. The subject has to read naturally in each sentence, which a template cannot check.
 */
describe('getConnectionNameStatus', () => {
    it.each([
        [ConnectionNameSubject.CONNECTION, 'Connection name is required'],
        [ConnectionNameSubject.SERVER, 'Server name is required'],
    ])('reports a missing name for %s', (subject, message) => {
        expect(getConnectionNameStatus('   ', false, subject)).toEqual({
            status: ConnectionTestStates.FAILED,
            message,
        });
    });

    it.each([
        [ConnectionNameSubject.CONNECTION, 'A connection named "Worker" already exists'],
        [ConnectionNameSubject.SERVER, 'A server named "Worker" already exists'],
    ])('names what it is that already exists for %s', (subject, message) => {
        expect(getConnectionNameStatus('  Worker  ', true, subject)).toEqual({
            status: ConnectionTestStates.FAILED,
            message,
        });
    });

    it.each([
        [ConnectionNameSubject.CONNECTION, 'Connection name is available'],
        [ConnectionNameSubject.SERVER, 'Server name is available'],
    ])('passes a free name for %s', (subject, message) => {
        expect(getConnectionNameStatus('Worker 2', false, subject)).toEqual({
            status: ConnectionTestStates.OK,
            message,
        });
    });
});
