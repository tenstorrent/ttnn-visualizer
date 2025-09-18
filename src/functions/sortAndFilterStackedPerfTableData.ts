// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { StackedTableFilter, StackedTableKeys, TypedStackedPerfRow } from '../definitions/StackedPerfTable';

const isFiltersActive = (filters: Record<StackedTableKeys, string> | null) =>
    filters ? Object.values(filters).some((filter) => filter.length > 0) : false;

const getCellText = (buffer: TypedStackedPerfRow, key: StackedTableKeys) => {
    const textValue = buffer[key]?.toString() || '';

    return textValue;
};

const sortAndFilterStackedPerfTableData = (
    data: TypedStackedPerfRow[],
    filterableColumnKeys: StackedTableKeys[],
    filters?: StackedTableFilter,
): TypedStackedPerfRow[] => {
    if (data?.length === 0) {
        return data;
    }

    let filteredRows = data || [];

    if (filters && isFiltersActive(filters) && filterableColumnKeys) {
        filteredRows = filteredRows.filter((row) => {
            const isFilteredOut =
                filters &&
                Object.entries(filters)
                    .filter(([_key, filterValue]) => String(filterValue).length)
                    .some(([key, filterValue]) => {
                        const bufferValue = getCellText(row, key as StackedTableKeys);

                        return !bufferValue.toLowerCase().includes(filterValue.toLowerCase());
                    });

            return !isFilteredOut;
        });
    }

    return filteredRows;
};

export default sortAndFilterStackedPerfTableData;
