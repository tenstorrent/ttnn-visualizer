// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { RemoteConnection } from '../src/model/RemoteConnection';
import { isSameConnection, remoteConnectionKey } from '../src/functions/remoteConnection';

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
