// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { filterByOperationRange, isInOperationRange } from '../src/functions/filterByOperationRange';

describe('isInOperationRange', () => {
    it('includes both bounds, an operation id of 0 among them', () => {
        expect([-1, 0, 1, 2, 3].map((id) => isInOperationRange(id, [0, 2]))).toEqual([false, true, true, true, false]);
    });

    it('keeps the same operations filterByOperationRange keeps', () => {
        const operations = [0, 1, 2, 3, 4].map((id) => ({ id }));

        expect(filterByOperationRange(operations, [1, 3])).toEqual(
            operations.filter(({ id }) => isInOperationRange(id, [1, 3])),
        );
        expect(filterByOperationRange(operations, [1, 3]).map(({ id }) => id)).toEqual([1, 2, 3]);
    });
});
