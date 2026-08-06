// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { RemoteConnection } from '../src/definitions/RemoteConnection';
import { isConnectionNameTaken, isSameConnection, remoteConnectionKey } from '../src/functions/remoteConnection';

const connection: RemoteConnection = {
    name: 'Worker',
    username: 'tt',
    host: 'worker-01',
    port: 2222,
    profilerPath: '/mem',
    performancePath: '/perf',
};

describe('isSameConnection', () => {
    it('matches a connection against itself', () => {
        expect(isSameConnection(connection, { ...connection })).toBe(true);
    });

    it('ignores editable properties that are not part of identity', () => {
        expect(
            isSameConnection(connection, {
                ...connection,
                username: 'someone-else',
                profilerPath: '/elsewhere',
                performancePath: '/elsewhere-perf',
                identityFile: '/tmp/id_ed25519',
            }),
        ).toBe(true);
    });

    it.each([
        ['name', { name: 'Other' }],
        ['host', { host: 'worker-02' }],
        ['port', { port: 22 }],
    ])('treats a different %s as a different connection', (_field, difference) => {
        expect(isSameConnection(connection, { ...connection, ...difference })).toBe(false);
    });

    it('is false when either side is missing', () => {
        expect(isSameConnection(connection, undefined)).toBe(false);
        expect(isSameConnection(connection, null)).toBe(false);
        expect(isSameConnection(undefined, connection)).toBe(false);
        expect(isSameConnection(null, null)).toBe(false);
    });
});

describe('remoteConnectionKey', () => {
    it('agrees with isSameConnection about which connections are the same', () => {
        const sameIdentity = { ...connection, profilerPath: '/elsewhere' };
        const differentHost = { ...connection, host: 'worker-02' };

        expect(remoteConnectionKey(connection)).toBe(remoteConnectionKey(sameIdentity));
        expect(remoteConnectionKey(connection)).not.toBe(remoteConnectionKey(differentHost));
    });

    it('separates connections that share a name but differ by host or port', () => {
        const keys = [
            remoteConnectionKey(connection),
            remoteConnectionKey({ ...connection, host: 'worker-02' }),
            remoteConnectionKey({ ...connection, port: 22 }),
        ];

        expect(new Set(keys).size).toBe(keys.length);
    });

    it('returns an empty string when there is no connection', () => {
        expect(remoteConnectionKey(undefined)).toBe('');
        expect(remoteConnectionKey(null)).toBe('');
    });
});

describe('isConnectionNameTaken', () => {
    const connections = [connection, { ...connection, name: 'Spare', host: 'worker-02' }];

    it('reports a name already carried by a saved connection', () => {
        expect(isConnectionNameTaken('Worker', connections)).toBe(true);
    });

    it('accepts a name no saved connection carries', () => {
        expect(isConnectionNameTaken('Worker 2', connections)).toBe(false);
    });

    it.each([
        ['case', 'worker'],
        ['surrounding space', '  Worker  '],
    ])('treats a name differing only by %s as the same name', (_difference, name) => {
        expect(isConnectionNameTaken(name, connections)).toBe(true);
    });

    it('accepts an edited connection keeping its own name', () => {
        expect(isConnectionNameTaken('Worker', connections, connection)).toBe(false);
    });

    it('still rejects an edit that takes another connection name', () => {
        expect(isConnectionNameTaken('Spare', connections, connection)).toBe(true);
    });

    it('excludes the edited connection by identity, not by name', () => {
        // Editing the host of a connection whose name is unchanged: the entry about to be
        // replaced is still in the list, and matching on name alone would find it.
        const movedHost = { ...connection, host: 'worker-99' };

        expect(isConnectionNameTaken(movedHost.name, connections, connection)).toBe(false);
    });

    it('finds nothing in an empty list', () => {
        expect(isConnectionNameTaken('Worker', [])).toBe(false);
    });
});
