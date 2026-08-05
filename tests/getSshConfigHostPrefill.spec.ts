// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import getSshConfigHostPrefill from '../src/functions/getSshConfigHostPrefill';

const DEFAULTS = {
    defaultUsername: 'default-user',
    defaultPort: 22,
};

describe('getSshConfigHostPrefill', () => {
    it('takes the alias, user, and port from the stanza', () => {
        const prefill = getSshConfigHostPrefill({ host: 'work-gpu', user: 'alice', port: 2222 }, DEFAULTS);

        expect(prefill).toEqual({
            host: 'work-gpu',
            name: 'work-gpu',
            username: 'alice',
            port: 2222,
            identityFile: undefined,
        });
    });

    it('keeps a name the user already typed', () => {
        const prefill = getSshConfigHostPrefill({ host: 'work-gpu' }, { ...DEFAULTS, name: '  my lab box  ' });

        expect(prefill.name).toBe('my lab box');
    });

    it('names the connection after the alias when the existing name is only whitespace', () => {
        const prefill = getSshConfigHostPrefill({ host: 'work-gpu' }, { ...DEFAULTS, name: '   ' });

        expect(prefill.name).toBe('work-gpu');
    });

    it('falls back to the form username when the stanza has no User', () => {
        const prefill = getSshConfigHostPrefill({ host: 'work-gpu' }, { ...DEFAULTS, username: 'carol' });

        expect(prefill.username).toBe('carol');
    });

    it('treats a whitespace-only stanza User as absent', () => {
        const prefill = getSshConfigHostPrefill({ host: 'work-gpu', user: '  ' }, { ...DEFAULTS, username: 'carol' });

        expect(prefill.username).toBe('carol');
    });

    it('falls back to the default username when neither the stanza nor the form has one', () => {
        const prefill = getSshConfigHostPrefill({ host: 'work-gpu' }, { ...DEFAULTS, username: '   ' });

        expect(prefill.username).toBe('default-user');
    });

    it('falls back to the form port, then the default port', () => {
        expect(getSshConfigHostPrefill({ host: 'work-gpu' }, { ...DEFAULTS, port: 2022 }).port).toBe(2022);
        expect(getSshConfigHostPrefill({ host: 'work-gpu' }, DEFAULTS).port).toBe(22);
    });

    it('clears the identity file so OpenSSH keeps applying the config for the alias', () => {
        const prefill = getSshConfigHostPrefill({ host: 'work-gpu' }, DEFAULTS);

        expect('identityFile' in prefill).toBe(true);
        expect(prefill.identityFile).toBeUndefined();
    });
});
