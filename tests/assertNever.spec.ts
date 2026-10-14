// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import assertNever from '../src/functions/assertNever';

describe('assertNever', () => {
    it('throws, naming the value the types ruled out', () => {
        expect(() => assertNever({ kind: 'from_a_newer_report' } as never)).toThrow(
            'Unhandled value: {"kind":"from_a_newer_report"}',
        );
    });
});
