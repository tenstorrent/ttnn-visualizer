// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import isUnmodelledIdealTime from '../src/functions/isUnmodelledIdealTime';

describe('isUnmodelledIdealTime', () => {
    it('reads exactly 1 ns as the perf model placeholder', () => {
        expect(isUnmodelledIdealTime(1)).toBe(true);
        expect(isUnmodelledIdealTime(parseFloat('1.0'))).toBe(true);
    });

    it.each([2, 0, 0.9999, 1.0004, -1, 300, Number.NaN, Number.POSITIVE_INFINITY, null])(
        'reads %s as not the placeholder',
        (idealNs) => {
            expect(isUnmodelledIdealTime(idealNs)).toBe(false);
        },
    );
});
