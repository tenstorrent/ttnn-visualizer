// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import {
    StackedTableFilter,
    StackedTableKeys,
    TypedStackedPerfRow,
    filterableStackedColumnKeys,
} from '../definitions/StackedPerfTable';

const isFiltersActive = (filters: Record<StackedTableKeys, string> | null) =>
    filters ? Object.values(filters).some((filter) => filter.length > 0) : false;

const getCellText = (buffer: TypedStackedPerfRow, key: StackedTableKeys) => {
    const textValue = buffer[key]?.toString() || '';

    return textValue;
};

const sortAndFilterStackedPerfTableData = (
    data: TypedStackedPerfRow[],
    filters: StackedTableFilter,
    rawOpCodeFilter: string[],
    stackByIn0: boolean,
): TypedStackedPerfRow[] => {
    if (data?.length === 0) {
        return data;
    }

    let filteredRows = data || [];

    // TODO: This should be moved to tt-perf-report as the printed report differs from the output csv
    filteredRows = filteredRows.sort((a, b) => {
        // First sort by device
        const deviceCompare = (a.device?.toString() || '').localeCompare(b.device?.toString() || '');
        if (deviceCompare !== 0) {
            return deviceCompare;
        }
        // Then sort by percent
        const percentA = typeof a.percent === 'number' ? a.percent : 0;
        const percentB = typeof b.percent === 'number' ? b.percent : 0;
        return percentB - percentA;
    });

    if (filters && isFiltersActive(filters) && filterableStackedColumnKeys) {
        filteredRows = filteredRows.filter((row) => {
            const isFilteredOut =
                filters &&
                Object.entries(filters)
                    .filter(([_key, filterValue]) => String(filterValue).length)
                    .some(([key, filterValue]) => {
                        const cellText = getCellText(row, key as StackedTableKeys);

                        return !cellText.toLowerCase().includes(filterValue.toLowerCase());
                    });

            return !isFilteredOut;
        });
    }

    if (rawOpCodeFilter?.length > 0) {
        filteredRows = filteredRows.filter(
            (row) =>
                row?.op_code !== null &&
                rawOpCodeFilter.some((filterValue) =>
                    stackByIn0
                        ? filterValue.toLowerCase() === row.op_code.toLowerCase()
                        : // TODO: This split is currently needed but we should store the data differently
                          filterValue.toLowerCase() === row.op_code.split(' ')[0].toLowerCase(),
                ),
        );
    }

    return filteredRows;
};

export default sortAndFilterStackedPerfTableData;
