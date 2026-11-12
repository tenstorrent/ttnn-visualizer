// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { isDeallocate } from '../src/definitions/Deallocate';

describe('isDeallocate', () => {
    it.each(['ttnn.deallocate', 'ttnn::deallocate', 'TTNN.Deallocate', 'TTNN::DEALLOCATE'])(
        'names %s a deallocate call',
        (name) => {
            expect(isDeallocate(name)).toBe(true);
        },
    );

    // `Tensor::deallocate` shares the leaf but is a different op.
    it.each(['ttnn.add', 'Tensor::deallocate', 'deallocate', '', null, undefined])('does not name %s one', (name) => {
        expect(isDeallocate(name)).toBe(false);
    });
});
