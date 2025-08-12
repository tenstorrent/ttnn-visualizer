// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useCallback, useState } from 'react';

export enum SortingDirection {
    ASC = 'asc',
    DESC = 'desc',
}

type SortingValue = string | number | null;

const sortAsc = (a: SortingValue, b: SortingValue): number => {
    // Nulls should be sorted to the end
    if (a === null || b === null) {
        return a === null ? 1 : -1;
    }

    if (a === undefined || b === undefined || a === b) {
        return 0;
    }

    if (typeof a !== typeof b) {
        return 1;
    }

    return a > b ? 1 : -1;
};

const sortDesc = (a: SortingValue, b: SortingValue): number => {
    // Nulls should be sorted to the end
    if (a === null || b === null) {
        return a === null ? 1 : -1;
    }

    if (a === undefined || b === undefined || a === b) {
        return 0;
    }

    if (typeof a !== typeof b) {
        return 1;
    }

    return a < b ? 1 : -1;
};

const useSortTable = (defaultSortingKey: SortingValue) => {
    const [sortingColumn, setSortingColumn] = useState<SortingValue>(defaultSortingKey);
    const [sortDirection, setSortDirection] = useState<SortingDirection | null>(SortingDirection.ASC);

    const sortTableFields = useCallback(
        <T extends Record<string, SortingValue>>(tableFields: T[]): T[] => {
            if (!sortingColumn) {
                return tableFields;
            }

            return [...tableFields].sort((a, b) =>
                sortDirection === SortingDirection.ASC
                    ? sortAsc(a[String(sortingColumn)], b[String(sortingColumn)])
                    : sortDesc(a[String(sortingColumn)], b[String(sortingColumn)]),
            );
        },
        [sortingColumn, sortDirection],
    );

    const changeSorting = (selectedColumn: SortingValue) => (direction: SortingDirection | null) => {
        setSortDirection(direction);
        setSortingColumn(selectedColumn);
    };

    return {
        sortTableFields,
        changeSorting,
        sortingColumn,
        sortDirection,
    };
};

export default useSortTable;
