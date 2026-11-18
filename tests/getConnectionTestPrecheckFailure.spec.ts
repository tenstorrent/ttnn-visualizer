// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import getConnectionTestPrecheckFailure, {
    FAILED_NO_CONNECTION,
    FAILED_NO_PATH,
    isConnectionTestPrecheckFailure,
} from '../src/functions/getConnectionTestPrecheckFailure';
import { RemoteConnection } from '../src/model/RemoteConnection';

describe('getConnectionTestPrecheckFailure', () => {
    it.each<[string, Partial<RemoteConnection>, ReturnType<typeof getConnectionTestPrecheckFailure>]>([
        ['no host', { host: '', port: 22, profilerPath: '/reports' }, FAILED_NO_CONNECTION],
        ['no port', { host: 'work-box', profilerPath: '/reports' }, FAILED_NO_CONNECTION],
        ['no host and no paths', { port: 22 }, FAILED_NO_CONNECTION],
        ['no paths', { host: 'work-box', port: 22 }, FAILED_NO_PATH],
        ['a memory path only', { host: 'work-box', port: 22, profilerPath: '/reports' }, null],
        ['a performance path only', { host: 'work-box', port: 22, performancePath: '/perf' }, null],
    ])('answers %s', (_case, connection, failure) => {
        expect(getConnectionTestPrecheckFailure(connection)).toBe(failure);
    });
});

describe('isConnectionTestPrecheckFailure', () => {
    it.each([FAILED_NO_CONNECTION, FAILED_NO_PATH])('recognises the form error %o', (failure) => {
        expect(isConnectionTestPrecheckFailure([failure])).toBe(true);
    });

    it('does not match a copy, which can only have come from elsewhere', () => {
        expect(isConnectionTestPrecheckFailure([{ ...FAILED_NO_CONNECTION }])).toBe(false);
    });

    it('does not match a result with more than one line', () => {
        expect(isConnectionTestPrecheckFailure([FAILED_NO_CONNECTION, FAILED_NO_PATH])).toBe(false);
    });
});
