// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { useCallback, useState } from 'react';

enum SortingDirection {
    ASC = 'asc',
    DESC = 'desc',
}

export interface SortingObject {
    value: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sortAsc = (a: any, b: any) => {
    if (a === undefined || b === undefined) {
        return 0;
    }
    if (typeof a === 'string' && typeof b === 'number') {
        return 1;
    }
    if (a === b) {
        return 0;
    }
    return a > b ? 1 : -1;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sortDesc = (a: any, b: any) => {
    if (a === undefined || b === undefined) {
        return 0;
    }
    if (typeof a === 'string' && typeof b === 'number') {
        return 1;
    }
    if (a === b) {
        return 0;
    }
    return a < b ? 1 : -1;
};

const useOperationsTable = () => {
    // const {
    //     handleSelectAllCores,
    //     handleSelectAllOperands,
    //     handleSelectAllSlowestOperands,
    //     getCoreSelectedState,
    //     getOperandSelectedState,
    //     getSlowestOperandSelectedState,
    // } = useSelectedTableRows();
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

export default useOperationsTable;
