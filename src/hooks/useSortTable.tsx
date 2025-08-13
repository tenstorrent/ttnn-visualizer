// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useCallback, useState } from 'react';

export enum SortingDirection {
    ASC = 'asc',
    DESC = 'desc',
}

type SortingValue = number | string | null;

const sortAsc = (a: SortingValue, b: SortingValue) => {
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

const sortDesc = (a: SortingValue, b: SortingValue) => {
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

const useSortTable = (defaultSortingKey: string | null) => {
    const [sortingColumn, setSortingColumn] = useState<string | null>(defaultSortingKey);
    const [sortDirection, setSortDirection] = useState<SortingDirection | null>(SortingDirection.ASC);

    const sortTableFields = useCallback(
        // TODO: Type this more strongly - https://github.com/tenstorrent/ttnn-visualizer/issues/738
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tableFields: any[]) => {
            if (!sortingColumn) {
                return tableFields;
            }

            return sortDirection === SortingDirection.ASC
                ? tableFields.sort((a, b) => sortAsc(a[sortingColumn], b[sortingColumn]))
                : tableFields.sort((a, b) => sortDesc(a[sortingColumn], b[sortingColumn]));
        },
        [sortingColumn, sortDirection],
    );

    const changeSorting = (selectedColumn: string | null) => (direction: SortingDirection | null) => {
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
