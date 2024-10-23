// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { useCallback, useState } from 'react';

export enum SortingDirection {
    ASC = 'asc',
    DESC = 'desc',
}

type SortingValue = number | string;

const sortAsc = (a: SortingValue, b: SortingValue) => {
    if (a === undefined || b === undefined || a === b) {
        return 0;
    }

    if (typeof a !== typeof b) {
        return 1;
    }

    return a > b ? 1 : -1;
};

const sortDesc = (a: SortingValue, b: SortingValue) => {
    if (a === undefined || b === undefined || a === b) {
        return 0;
    }

    if (typeof a !== typeof b) {
        return 1;
    }

    return a < b ? 1 : -1;
};

const useBuffersTable = () => {
    const [sortingColumn, setSortingColumn] = useState<string>('');
    const [sortDirection, setSortDirection] = useState<SortingDirection>(SortingDirection.DESC);

    const sortTableFields = useCallback(
        (tableFields: []) =>
            sortDirection === SortingDirection.ASC
                ? tableFields.sort((a, b) => sortAsc(a ? a[sortingColumn] : '', b ? b[sortingColumn] : ''))
                : tableFields.sort((a, b) => sortDesc(a ? a[sortingColumn] : '', b ? b[sortingColumn] : '')),
        [sortingColumn, sortDirection],
    );

    const changeSorting = (selectedColumn: string) => (direction: SortingDirection) => {
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

export default useBuffersTable;
