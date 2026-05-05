// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import {
    StackedColumnKeys,
    StackedTableFilter,
    TypedStackedPerfRow,
    filterableStackedColumnKeys,
} from '../definitions/StackedPerfTable';

const isFiltersActive = (filters: StackedTableFilter) =>
    filters ? Object.values(filters).some((filter) => filter && filter.length > 0) : false;

const getCellText = (buffer: TypedStackedPerfRow, key: StackedColumnKeys) => {
    const textValue = buffer[key]?.toString() || '';

    return textValue;
};

const sortAndFilterStackedPerfTableData = (
    data: TypedStackedPerfRow[],
    filters: StackedTableFilter,
    rawOpCodeFilter: string[],
    isGroupedByMemory: boolean,
): TypedStackedPerfRow[] => {
    if (data?.length === 0) {
        return data;
    }

    let filteredRows = data || [];

    // TODO: This should be moved to tt-perf-report as the printed report differs from the output csv
    filteredRows = filteredRows.sort((a, b) => {
        // First sort by device (numeric comparison)
        const deviceA = a[StackedColumnKeys.Device] ?? Number.MAX_SAFE_INTEGER;
        const deviceB = b[StackedColumnKeys.Device] ?? Number.MAX_SAFE_INTEGER;
        const deviceCompare = deviceA - deviceB;
        if (deviceCompare !== 0) {
            return deviceCompare;
        }
        // Then sort by percent
        const percentA = typeof a[StackedColumnKeys.Percent] === 'number' ? a[StackedColumnKeys.Percent] : 0;
        const percentB = typeof b[StackedColumnKeys.Percent] === 'number' ? b[StackedColumnKeys.Percent] : 0;
        return percentB - percentA;
    });

    if (filters && isFiltersActive(filters) && filterableStackedColumnKeys) {
        filteredRows = filteredRows.filter((row) => {
            const isFilteredOut =
                filters &&
                Object.entries(filters)
                    .filter(([_key, filterValue]) => String(filterValue).length)
                    .some(([key, filterValue]) => {
                        const cellText = getCellText(row, key as StackedColumnKeys);

                        return !cellText.toLowerCase().includes(filterValue.toLowerCase());
                    });

            return !isFilteredOut;
        });
    }

    if (rawOpCodeFilter?.length > 0) {
        filteredRows = filteredRows.filter(
            (row) =>
                row?.[StackedColumnKeys.OpCode] !== null &&
                rawOpCodeFilter.some((filterValue) =>
                    isGroupedByMemory
                        ? filterValue.toLowerCase() === row[StackedColumnKeys.OpCode].toLowerCase()
                        : // TODO: This split is currently needed but we should store the data differently
                          filterValue.toLowerCase() === row[StackedColumnKeys.OpCode].split(' ')[0].toLowerCase(),
                ),
        );
    }

    return filteredRows;
};

export default sortAndFilterStackedPerfTableData;
