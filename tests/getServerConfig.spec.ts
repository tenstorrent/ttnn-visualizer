// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SSH_PORT } from '../src/definitions/RemoteConnection';
import { getOptionalPathDefault, getValidSshDefaultPort, isServerModeEnabled } from '../src/functions/getServerConfig';

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

describe('isServerModeEnabled', () => {
    // A Vite env var is always a string, so the pre-`!!` reading of 'false' was `true`,
    // which hides the local-only UI that a dev install is meant to expose.
    it.each(['false', 'FALSE', '0', '', 'no', 'yes', 't', 'maybe'])('is false for %p', (value) => {
        expect(isServerModeEnabled(value)).toBe(false);
    });

    it.each([undefined, null, 1, {}, []])('is false for %p, which names no posture', (value) => {
        expect(isServerModeEnabled(value)).toBe(false);
    });

    // The shipped branch reads JSON the backend inlined, where the value is a real boolean.
    it.each([
        [true, true],
        [false, false],
    ])('passes the boolean %p through as %p', (value, expected) => {
        expect(isServerModeEnabled(value)).toBe(expected);
    });

    it.each(['true', 'TRUE', 'True', '1'])('is true for %p', (value) => {
        expect(isServerModeEnabled(value)).toBe(true);
    });

    // A trailing space in an .env line is invisible and reaches us intact, and the
    // backend's parse_bool trims — the two must not disagree about the same spelling.
    it.each([' true', 'true ', '  1  ', '\ttrue\n'])('trims surrounding whitespace in %p', (value) => {
        expect(isServerModeEnabled(value)).toBe(true);
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

    it.each([
        ['false', false],
        ['1', true],
    ])('reads VITE_SERVER_MODE=%s as %s', async (value, expected) => {
        vi.stubEnv('VITE_SERVER_MODE', value);

        const { default: getServerConfig } = await import('../src/functions/getServerConfig');

        expect(getServerConfig().SERVER_MODE).toBe(expected);
    });

    it.each([
        ['false', false],
        ['0', false],
        ['true', true],
        ['1', true],
        [undefined, false],
    ])('reads VITE_NEW_MENU=%p as %s', async (value, expected) => {
        // Stubbed even for the unset case: Vite folds a developer `.env` into
        // `import.meta.env`, so asserting on absence would instead read whichever menu
        // that particular checkout happens to configure.
        vi.stubEnv('VITE_NEW_MENU', value);

        const { default: getServerConfig } = await import('../src/functions/getServerConfig');

        expect(getServerConfig().NEW_MENU).toBe(expected);
    });

    it('falls back when VITE_SSH_DEFAULT_PORT is invalid', async () => {
        vi.stubEnv('VITE_SSH_DEFAULT_PORT', 'not-a-port');

        const { default: getServerConfig } = await import('../src/functions/getServerConfig');

        expect(getServerConfig().SSH_DEFAULT_PORT).toBe(DEFAULT_SSH_PORT);
    });

    // The backend refuses to start on a spelling it can't read; the SPA can only fall back
    // to the local posture, so the typo has to be visible or the wrong posture gets tested.
    it.each(['yes', 't', 'Ture', ''])('warns that VITE_SERVER_MODE=%p is unrecognised', async (value) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubEnv('VITE_SERVER_MODE', value);

        const { default: getServerConfig } = await import('../src/functions/getServerConfig');

        expect(getServerConfig().SERVER_MODE).toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('VITE_SERVER_MODE'));

        warn.mockRestore();
    });

    it.each(['true', 'false', '1', '0'])('stays quiet for the documented value %p', async (value) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubEnv('VITE_SERVER_MODE', value);

        const { default: getServerConfig } = await import('../src/functions/getServerConfig');
        getServerConfig();

        expect(warn).not.toHaveBeenCalled();

        warn.mockRestore();
    });
});

describe('getServerConfig (shipped / inlined window config)', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
        delete window.TTNN_VISUALIZER_CONFIG;
    });

    // The branch the hosted deployment takes, and the one that still read `|| false`.
    it.each([
        [{ SERVER_MODE: true }, true],
        [{ SERVER_MODE: false }, false],
        [{}, false],
        // Not the shape the backend emits — this is the regression that would silently
        // invert the posture if serialisation ever stringified a boolean again.
        [{ SERVER_MODE: 'false' as unknown as boolean }, false],
    ])('reads %o as SERVER_MODE=%s', async (windowConfig, expected) => {
        vi.stubEnv('DEV', false);
        window.TTNN_VISUALIZER_CONFIG = windowConfig;

        const { default: getServerConfig } = await import('../src/functions/getServerConfig');

        expect(getServerConfig().SERVER_MODE).toBe(expected);
    });

    it.each([
        [{ NEW_MENU: true }, true],
        [{ NEW_MENU: false }, false],
        [{}, false],
        // Same stringification hazard as SERVER_MODE: a truthy `'false'` would turn the
        // menu on for every hosted visitor.
        [{ NEW_MENU: 'false' as unknown as boolean }, false],
    ])('reads %o as NEW_MENU=%s', async (windowConfig, expected) => {
        vi.stubEnv('DEV', false);
        window.TTNN_VISUALIZER_CONFIG = windowConfig;

        const { default: getServerConfig } = await import('../src/functions/getServerConfig');

        expect(getServerConfig().NEW_MENU).toBe(expected);
    });

    it('defaults the rest of the config when nothing was inlined', async () => {
        vi.stubEnv('DEV', false);

        const { default: getServerConfig } = await import('../src/functions/getServerConfig');
        const config = getServerConfig();

        expect(config.SERVER_MODE).toBe(false);
        expect(config.BASE_PATH).toBe('/');
        expect(config.SSH_DEFAULT_PORT).toBe(DEFAULT_SSH_PORT);
    });
});
