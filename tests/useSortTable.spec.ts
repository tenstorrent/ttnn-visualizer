// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import useSortTable, { SortingDirection } from '../src/hooks/useSortTable';

// A placeholder row between measured ones lacks the key, so its value reads as undefined.
const ROWS: Record<string, number | null>[] = [
    { id: 1, value: 80 },
    { id: 2 },
    { id: 3, value: 20 },
    { id: 4, value: 40 },
];

const sortedIds = (direction: SortingDirection) => {
    const { result } = renderHook(() => useSortTable('value'));

    act(() => result.current.changeSorting('value')(direction));

    return result.current.sortTableFields(ROWS).map((row) => row.id);
};

describe('useSortTable', () => {
    it.each([
        { direction: SortingDirection.ASC, expected: [3, 4, 1, 2] },
        { direction: SortingDirection.DESC, expected: [1, 4, 3, 2] },
    ])('sorts a row without the key after every measured row, $direction', ({ direction, expected }) => {
        expect(sortedIds(direction)).toEqual(expected);
    });

    it('keeps a row without the key and a null one together, in their order, at the end', () => {
        const { result } = renderHook(() => useSortTable('value'));

        expect(
            result.current
                .sortTableFields([{ id: 1 }, { id: 2, value: 5 }, { id: 3, value: null }])
                .map((row) => row.id),
        ).toEqual([2, 1, 3]);
    });
});
