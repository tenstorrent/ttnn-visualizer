// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SSH_PORT } from '../src/definitions/RemoteConnection';
import { getOptionalPathDefault, getValidSshDefaultPort } from '../src/functions/getServerConfig';

describe('getValidSshDefaultPort', () => {
    it.each([0, 65536, -1, 'abc', '22.5', undefined, null, Number.NaN])(
        'falls back to DEFAULT_SSH_PORT for invalid value %p',
        (value) => {
            expect(getValidSshDefaultPort(value)).toBe(DEFAULT_SSH_PORT);
        },
    );

    it.each([1, 65535, 2222, '2222'])('accepts valid port %p', (value) => {
        expect(getValidSshDefaultPort(value)).toBe(Number(value));
    });
});

describe('getOptionalPathDefault', () => {
    it.each([null, undefined, 123, {}, []])('returns empty string for non-string %p', (value) => {
        expect(getOptionalPathDefault(value)).toBe('');
    });

    it('trims whitespace and returns empty for whitespace-only', () => {
        expect(getOptionalPathDefault(' /a/b ')).toBe('/a/b');
        expect(getOptionalPathDefault('   ')).toBe('');
    });
});

describe('getServerConfig (dev / Vite env)', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('reads VITE_SSH_* defaults through the same validators', async () => {
        vi.stubEnv('VITE_SSH_DEFAULT_PORT', '45985');
        vi.stubEnv('VITE_SSH_DEFAULT_PROFILER_PATH', ' /mem/ ');
        vi.stubEnv('VITE_SSH_DEFAULT_PERFORMANCE_PATH', '/perf');
        vi.stubEnv('VITE_USERNAME', 'dev-user');

        const { default: getServerConfig } = await import('../src/functions/getServerConfig');
        const config = getServerConfig();

        expect(config.SSH_DEFAULT_PORT).toBe(45985);
        expect(config.SSH_DEFAULT_PROFILER_PATH).toBe('/mem/');
        expect(config.SSH_DEFAULT_PERFORMANCE_PATH).toBe('/perf');
        expect(config.USERNAME).toBe('dev-user');
    });

    it('falls back when VITE_SSH_DEFAULT_PORT is invalid', async () => {
        vi.stubEnv('VITE_SSH_DEFAULT_PORT', 'not-a-port');

        const { default: getServerConfig } = await import('../src/functions/getServerConfig');

        expect(getServerConfig().SSH_DEFAULT_PORT).toBe(DEFAULT_SSH_PORT);
    });
});
