// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { getActiveMlirServer } from '../src/functions/mlirServer';
import { MlirServerConnection } from '../src/model/MlirServer';

const serverA: MlirServerConnection = {
    name: 'A',
    username: 'tt',
    host: 'a.example',
    sshPort: 22,
    port: 8080,
};

const serverB: MlirServerConnection = {
    name: 'B',
    username: 'tt',
    host: 'b.example',
    sshPort: 22,
    port: 8080,
};

describe('getActiveMlirServer', () => {
    it('returns the selected server when it is in the list', () => {
        expect(getActiveMlirServer([serverA, serverB], serverB)).toBe(serverB);
    });

    it('falls back to the first listed server when selection is null', () => {
        expect(getActiveMlirServer([serverA, serverB], null)).toBe(serverA);
    });

    it('falls back to the first listed server when selection is not in the list', () => {
        expect(getActiveMlirServer([serverA], serverB)).toBe(serverA);
    });

    it('returns null when there are no servers', () => {
        expect(getActiveMlirServer([], serverA)).toBeNull();
        expect(getActiveMlirServer([], null)).toBeNull();
    });
});
