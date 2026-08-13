// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { MAX_PORT } from '../src/definitions/SshConnectionFields';
import getPortFromInput from '../src/functions/getPortFromInput';

const EMPTY_PORT = 0;

describe('getPortFromInput', () => {
    it('returns the caller-supplied empty value for a cleared field', () => {
        expect(getPortFromInput('', EMPTY_PORT)).toBe(EMPTY_PORT);
        expect(getPortFromInput('', undefined)).toBeUndefined();
    });

    it.each([1, 22, 2222, MAX_PORT])('accepts port %p', (port) => {
        expect(getPortFromInput(String(port), EMPTY_PORT)).toBe(port);
    });

    it.each([MAX_PORT + 1, 99999, 0, -1])('ignores the keystroke for out-of-range %p', (port) => {
        expect(getPortFromInput(String(port), EMPTY_PORT)).toBeNull();
    });

    // Typing a legal port a digit at a time must never hit the bound part-way.
    it('accepts every prefix of the highest legal port', () => {
        const digits = String(MAX_PORT).split('');

        digits.forEach((_, index) => {
            const prefix = digits.slice(0, index + 1).join('');

            expect(getPortFromInput(prefix, EMPTY_PORT)).toBe(Number(prefix));
        });
    });
});
