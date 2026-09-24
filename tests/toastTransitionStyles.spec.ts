// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Asserted against the stylesheet text because jsdom does not compile SCSS.
const COMMON = readFileSync(resolve(process.cwd(), 'src/scss/_common.scss'), { encoding: 'utf8' });
const TOAST_OVERRIDES = readFileSync(resolve(process.cwd(), 'src/scss/components/ToastOverrides.scss'), {
    encoding: 'utf8',
});

describe('toast exit styles', () => {
    it('does not hide exiting toasts with display:none', () => {
        expect(COMMON).not.toContain('.no-toast-animation');
    });

    it('gives the immediate-exit class a duration that still fires animationend', () => {
        const start = TOAST_OVERRIDES.indexOf('.toast-exit-immediate');
        expect(start, '.toast-exit-immediate not found').toBeGreaterThan(-1);
        const open = TOAST_OVERRIDES.indexOf('{', start);
        const body = TOAST_OVERRIDES.slice(open + 1, TOAST_OVERRIDES.indexOf('}', open));

        expect(body).toMatch(/animation-duration:\s*1ms/);
    });
});
