// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import {
    FilterableStackedColumnKeys,
    StackedTableFilter,
    StackedTableKeys,
    TypedStackedPerfRow,
} from '../definitions/StackedPerfTable';
import { TableFilterValue } from '../hooks/useTableFilter';

const isFiltersActive = (filters: Record<StackedTableKeys, string> | null) =>
    filters ? Object.values(filters).some((filter) => filter.length > 0) : false;

const getCellText = (buffer: TypedStackedPerfRow, key: StackedTableKeys) => {
    const textValue = buffer[key]?.toString() || '';

    return textValue;
};

const sortAndFilterStackedPerfTableData = (
    data: TypedStackedPerfRow[],
    filters: StackedTableFilter,
    rawOpCodeFilter: TableFilterValue[],
): TypedStackedPerfRow[] => {
    if (data?.length === 0) {
        return data;
    }

    let filteredRows = data || [];

    if (filters && isFiltersActive(filters) && FilterableStackedColumnKeys) {
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

    // In the stacked data the op_code field is named just "op_code" not "raw_op_code"
    if (rawOpCodeFilter?.length > 0) {
        filteredRows = filteredRows.filter(
            (row) =>
                row?.op_code !== null &&
                rawOpCodeFilter.some((filterValue) => row.op_code.toLowerCase().includes(filterValue.toLowerCase())),
        );
    }

    return filteredRows;
};

export default sortAndFilterStackedPerfTableData;
